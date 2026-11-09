import { useEffect, useState } from 'react';
import type {
  Completeness,
  Finding,
  Folder,
  Idea,
  ResearchReport,
  SavedPrompt,
  UsageLevel,
} from '../../shared/types';
import { formatDate, shortDate } from '../lib/util';
import { Meter, Section } from './ui';

interface IdeaViewProps {
  idea: Idea;
  folders: Folder[];
  prompts: SavedPrompt[];
  scanning: boolean;
  busy: boolean;
  onScan: () => void;
  onDelete: () => void;
  onMove: (folderId: string | null) => void;
  onOpenExternal: (url: string) => void;
}

const COMPLETENESS_LABEL: Record<Completeness, string> = {
  production: 'SHIPPED',
  beta: 'BETA',
  prototype: 'PROTOTYPE',
  abandoned: 'ABANDONED',
  unknown: 'UNVERIFIED',
};

const USAGE_LABEL: Record<UsageLevel, string> = {
  major: 'WIDELY USED',
  notable: 'IN USE',
  niche: 'NICHE',
  low: 'LOW USAGE',
  unknown: 'USAGE ?',
};

const LEVEL_LABEL = {
  open: 'OPEN FIELD',
  differentiated: 'CONTESTED',
  crowded: 'CROWDED',
} as const;

function usageTitle(finding: Finding): string {
  if (finding.source === 'github' && typeof finding.stars === 'number') {
    return `${finding.stars.toLocaleString()} stars${
      finding.orgBacked ? ', maintained by an organization' : ''
    }`;
  }
  if (finding.source === 'hn' && typeof finding.points === 'number') {
    return `${finding.points} points and ${finding.comments ?? 0} comments on Hacker News`;
  }
  return 'No hard usage signal for this result';
}

function FindingRow({
  finding,
  onOpenExternal,
}: {
  finding: Finding;
  onOpenExternal: (url: string) => void;
}) {
  return (
    <article className="finding">
      <button
        type="button"
        className="finding-main"
        onClick={() => onOpenExternal(finding.url)}
        title={`Open ${finding.url}`}
      >
        <span className="finding-name">
          {finding.name}
          <span className="ext" aria-hidden="true">
            ↗
          </span>
        </span>
        <span className="finding-desc">{finding.note || finding.description}</span>
      </button>
      <div className="finding-badges">
        {finding.source === 'github' && typeof finding.stars === 'number' ? (
          <span className="tag" title={usageTitle(finding)}>
            ★ {finding.stars.toLocaleString()}
          </span>
        ) : null}
        {finding.source === 'hn' ? (
          <span className="tag" title={usageTitle(finding)}>
            {finding.points ?? 0} PTS
          </span>
        ) : null}
        {finding.source === 'web' ? <span className="tag">WEB</span> : null}
        {finding.source === 'github' && finding.lastPush ? (
          <span className="tag">PUSH {shortDate(finding.lastPush)}</span>
        ) : null}
        <span className={`tag completeness-${finding.completeness}`}>
          {COMPLETENESS_LABEL[finding.completeness]}
        </span>
        <span className={`tag usage-${finding.usage}`} title={usageTitle(finding)}>
          {USAGE_LABEL[finding.usage]}
        </span>
        <span className={`tag similarity-${finding.similarity}`}>
          {finding.similarity.toUpperCase()}
        </span>
        {finding.orgBacked ? <span className="tag">ORG</span> : null}
        {finding.archived ? <span className="tag tag-danger">ARCHIVED</span> : null}
      </div>
    </article>
  );
}

function ReportView({
  report,
  onOpenExternal,
}: {
  report: ResearchReport;
  onOpenExternal: (url: string) => void;
}) {
  const github = report.findings.filter((finding) => finding.source === 'github');
  const discussion = report.findings.filter((finding) => finding.source !== 'github');

  return (
    <div className="report">
      <div className={`verdict level-${report.verdict.level}`}>
        <div className="verdict-head">
          <span className="verdict-label">{LEVEL_LABEL[report.verdict.level]}</span>
          <span className="verdict-count">{report.findings.length} MATCHES</span>
        </div>
        <p>{report.verdict.summary}</p>
        {report.verdict.gaps.length > 0 || report.verdict.angles.length > 0 ? (
          <div className="verdict-cols">
            <div>
              <h4>GAPS TO TAKE</h4>
              <ul>
                {report.verdict.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>ANGLES FORWARD</h4>
              <ul>
                {report.verdict.angles.map((angle) => (
                  <li key={angle}>{angle}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>

      <div className="report-meta">
        <span>SCANNED {formatDate(report.createdAt)}</span>
        <span>{report.assessed ? 'MODEL-ASSESSED' : 'RAW MATCHES'}</span>
        {typeof report.githubQueries === 'number' ? (
          <span>GITHUB {report.githubQueries} QUERIES</span>
        ) : null}
        {report.cacheHits ? <span>{report.cacheHits} CACHED</span> : null}
        <span>{report.model.toUpperCase()}</span>
      </div>

      {!report.assessed ? (
        <p className="error-note">
          The model could not grade this evidence, so completeness is a heuristic and similarity is
          unrated. The matches and usage numbers are still real.
        </p>
      ) : null}

      {github.length > 0 ? (
        <div className="finding-group">
          <h3 className="finding-head">
            GITHUB REPOSITORIES <span>{github.length}</span>
          </h3>
          {github.map((finding) => (
            <FindingRow key={finding.id} finding={finding} onOpenExternal={onOpenExternal} />
          ))}
        </div>
      ) : null}

      {discussion.length > 0 ? (
        <div className="finding-group">
          <h3 className="finding-head">
            WEB &amp; DISCUSSION <span>{discussion.length}</span>
          </h3>
          {discussion.map((finding) => (
            <FindingRow key={finding.id} finding={finding} onOpenExternal={onOpenExternal} />
          ))}
        </div>
      ) : null}

      {report.findings.length === 0 ? (
        <p className="empty-note">
          Nothing similar surfaced. Treat that as a starting point, not proof that the idea is new.
        </p>
      ) : null}

      <details className="queries">
        <summary>SEARCHES USED ({report.queries.length})</summary>
        <ul>
          {report.queries.map((query) => (
            <li key={query}>{query}</li>
          ))}
        </ul>
      </details>

      {report.notices.length > 0 ? (
        <ul className="report-notices">
          {report.notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function IdeaView({
  idea,
  folders,
  prompts,
  scanning,
  busy,
  onScan,
  onDelete,
  onMove,
  onOpenExternal,
}: IdeaViewProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 3500);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  const prompt = idea.promptId ? prompts.find((item) => item.id === idea.promptId) : undefined;
  const scanDisabled = busy || scanning;
  const isGenerated = idea.kind === 'generated';

  return (
    <div className="view idea-view rise">
      <header className="view-head idea-head">
        <span className="eyebrow">
          {isGenerated ? 'GENERATED IDEA' : 'VERIFIED IDEA'} · {formatDate(idea.createdAt)}
          {idea.model ? ` · ${idea.model}` : ''}
        </span>
        <h1 className="display idea-title-lg">{idea.title}</h1>
        {idea.oneLiner ? <p className="lede">{idea.oneLiner}</p> : null}
        <div className="idea-actions">
          <button
            type="button"
            className="btn primary"
            onClick={onScan}
            disabled={scanDisabled}
            title={
              idea.report
                ? 'Run a fresh scan and ignore cached research'
                : 'Search GitHub, the web and Hacker News'
            }
          >
            {scanning ? 'SCANNING…' : idea.report ? 'RE-SCAN PROJECTS' : 'SCAN PROJECTS'}
          </button>
          <select
            className="folder-select"
            aria-label="Move idea to folder"
            value={idea.folderId ?? ''}
            onChange={(event) => onMove(event.target.value || null)}
          >
            <option value="">UNFILED</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              if (confirmDelete) onDelete();
              else setConfirmDelete(true);
            }}
          >
            {confirmDelete ? 'SURE? DELETE' : 'DELETE'}
          </button>
        </div>
      </header>

      <div className="idea-grid">
        <div className="idea-main">
          <Section index="01" title="What it is">
            <p className="copy">{idea.description}</p>
          </Section>

          {isGenerated ? (
            <Section index="02" title="Shape">
              {idea.targetUser ? (
                <p className="copy">
                  <span className="inline-label">FOR</span>
                  {idea.targetUser}
                </p>
              ) : null}
              {idea.coreFeatures && idea.coreFeatures.length > 0 ? (
                <ol className="feature-list">
                  {idea.coreFeatures.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ol>
              ) : null}
              {idea.whyUnique ? <p className="pullquote">{idea.whyUnique}</p> : null}
              {idea.risks && idea.risks.length > 0 ? (
                <div className="risk-block">
                  <span className="inline-label">RISKS</span>
                  <ul>
                    {idea.risks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Section>
          ) : null}

          <Section
            index={isGenerated ? '03' : '02'}
            title="Existing projects"
            aside={idea.report ? `${idea.report.findings.length} MATCHES` : 'NOT SCANNED'}
          >
            {idea.report ? (
              <ReportView report={idea.report} onOpenExternal={onOpenExternal} />
            ) : (
              <div className="report-empty">
                {idea.knownProjects && idea.knownProjects.length > 0 ? (
                  <>
                    <span className="inline-label">MODEL KNOWLEDGE · UNVERIFIED</span>
                    <ul className="project-list">
                      {idea.knownProjects.map((item) => (
                        <li key={item.name}>
                          <strong>{item.name}</strong>
                          {item.note ? <span>{item.note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="empty-note">No scan yet for this idea.</p>
                )}
                <p className="fineprint">
                  A scan reads GitHub repositories, general web results and Hacker News, then grades
                  completeness and real usage for every match it keeps.
                </p>
                <button type="button" className="btn" onClick={onScan} disabled={scanDisabled}>
                  RUN PROJECT SCAN →
                </button>
              </div>
            )}
          </Section>
        </div>

        <aside className="idea-side">
          <Section index="A" title="Tech stack" aside={isGenerated ? 'CHOSEN' : undefined}>
            {idea.techStack.length > 0 ? (
              <div className="chips">
                {idea.techStack.map((item) => (
                  <span className="chip" key={`${item.name}-${item.role}`}>
                    <strong>{item.name}</strong>
                    {item.role ? <em>{item.role}</em> : null}
                  </span>
                ))}
              </div>
            ) : (
              <p className="empty-note">No stack recorded.</p>
            )}
          </Section>

          {idea.viability ? (
            <Section index="B" title="Viability" aside="ESTIMATE">
              <div className="score">
                <span className="score-num">{idea.viability.score}</span>
                <span className="score-den">/100</span>
              </div>
              <Meter value={idea.viability.score} />
              {idea.viability.notes ? <p className="side-note">{idea.viability.notes}</p> : null}
            </Section>
          ) : null}

          {idea.build ? (
            <Section index="C" title="Build plan">
              <div className="meta-list">
                <div className="meta-row">
                  <span>TIME</span>
                  <span className="meta-value">{idea.build.weeks} WEEKS</span>
                </div>
                <div className="meta-row">
                  <span>DIFFICULTY</span>
                  <span className="meta-value">{idea.build.difficulty.toUpperCase()}</span>
                </div>
              </div>
              {idea.build.mvpScope ? <p className="side-note">{idea.build.mvpScope}</p> : null}
            </Section>
          ) : null}

          <Section index="D" title="Record">
            <div className="meta-list">
              <div className="meta-row">
                <span>CREATED</span>
                <span className="meta-value">{formatDate(idea.createdAt)}</span>
              </div>
              <div className="meta-row">
                <span>UPDATED</span>
                <span className="meta-value">{formatDate(idea.updatedAt)}</span>
              </div>
              {idea.model ? (
                <div className="meta-row">
                  <span>MODEL</span>
                  <span className="meta-value meta-truncate">{idea.model}</span>
                </div>
              ) : null}
              <div className="meta-row">
                <span>EXISTING PROJECTS</span>
                <span className="meta-value">
                  {idea.report ? `${idea.report.findings.length} MATCHES` : 'NOT SCANNED'}
                </span>
              </div>
            </div>
            {prompt ? (
              <div className="prompt-memory">
                <span className="inline-label">BRIEF</span>
                <p>{prompt.themes || '—'}</p>
                {prompt.goals ? <p>{prompt.goals}</p> : null}
              </div>
            ) : null}
          </Section>
        </aside>
      </div>
    </div>
  );
}

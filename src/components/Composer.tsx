import type { SavedPrompt } from '../../shared/types';
import type { Brief } from '../lib/util';
import { FieldLabel } from './ui';

interface ComposerProps {
  draft: Brief;
  prompts: SavedPrompt[];
  busy: boolean;
  model: string;
  onDraft: (patch: Partial<Brief>) => void;
  onRun: (brief: Brief) => void;
  onDeletePrompt: (id: string) => void;
}

export function Composer({
  draft,
  prompts,
  busy,
  model,
  onDraft,
  onRun,
  onDeletePrompt,
}: ComposerProps) {
  const canRun = Boolean(draft.themes.trim() || draft.goals.trim()) && !busy && Boolean(model);
  const ordered = [...prompts].sort((a, b) => b.lastRunAt - a.lastRunAt);

  return (
    <div className="view composer-view rise">
      <header className="view-head">
        <span className="eyebrow">01 / GENERATE</span>
        <h1 className="display">Find an idea worth building.</h1>
        <p className="lede">
          Give the engine a theme and a goal. It returns distinct, buildable products — and picks a
          stack for each one when you leave that field open.
        </p>
      </header>

      <div className="composer-grid">
        <form
          className="panel brief-panel"
          onSubmit={(event) => {
            event.preventDefault();
            if (canRun) onRun(draft);
          }}
        >
          <div className="panel-head">
            <span>BRIEF</span>
            <span className="panel-meta">{draft.count} AT A TIME</span>
          </div>
          <div className="panel-body">
            <label className="field">
              <FieldLabel text="THEMES" hint="domains, obsessions, materials" />
              <input
                value={draft.themes}
                placeholder="field biology, repair culture, community radio"
                onChange={(event) => onDraft({ themes: event.target.value })}
              />
            </label>

            <label className="field">
              <FieldLabel text="GOALS" hint="what should it change?" />
              <input
                value={draft.goals}
                placeholder="give small labs a way to publish verified specimen records"
                onChange={(event) => onDraft({ goals: event.target.value })}
              />
            </label>

            <label className="field">
              <FieldLabel
                text="TECH STACK"
                hint="leave blank and every idea gets its own"
                optional
              />
              <input
                value={draft.stack}
                placeholder="Tauri, SQLite, SvelteKit"
                onChange={(event) => onDraft({ stack: event.target.value })}
              />
            </label>

            <div className="field-row">
              <div className="field">
                <span className="label">
                  IDEAS PER RUN <em>1–5</em>
                </span>
                <div className="seg" role="group" aria-label="Ideas per run">
                  {[1, 2, 3, 4, 5].map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={count === draft.count ? 'is-on' : ''}
                      aria-pressed={count === draft.count}
                      onClick={() => onDraft({ count })}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
              <button type="submit" className="btn primary go" disabled={!canRun}>
                {busy ? 'WORKING…' : 'GENERATE →'}
              </button>
            </div>

            <p className="fineprint">
              Every brief is saved to the workspace. Run it again any time for another batch — the same
              prompt goes back to the model, unchanged.
            </p>
          </div>
        </form>

        <aside className="panel prompts-panel">
          <div className="panel-head">
            <span>SAVED BRIEFS</span>
            <span className="panel-meta">{prompts.length}</span>
          </div>
          <div className="prompt-list">
            {ordered.length === 0 ? (
              <div className="empty-block">
                <p>No briefs yet.</p>
                <span>Your first run appears here, ready to re-run verbatim.</span>
              </div>
            ) : null}
            {ordered.map((prompt) => (
              <article className="prompt" key={prompt.id}>
                <div className="prompt-top">
                  <span className="tag tag-solid">{prompt.count}×</span>
                  <span className="prompt-runs">
                    {prompt.runs} run{prompt.runs === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Delete saved brief"
                    title="Delete saved brief"
                    onClick={() => onDeletePrompt(prompt.id)}
                  >
                    ×
                  </button>
                </div>
                <p className="prompt-text">{prompt.themes || '—'}</p>
                {prompt.goals ? <p className="prompt-goal">{prompt.goals}</p> : null}
                {prompt.stack ? <p className="prompt-stack">STACK / {prompt.stack}</p> : null}
                <div className="prompt-actions">
                  <button
                    type="button"
                    className="btn tiny"
                    disabled={busy}
                    onClick={() => onRun(prompt)}
                  >
                    RUN AGAIN
                  </button>
                  <button
                    type="button"
                    className="btn tiny ghost"
                    disabled={busy}
                    onClick={() =>
                      onDraft({
                        themes: prompt.themes,
                        goals: prompt.goals,
                        stack: prompt.stack,
                        count: prompt.count,
                      })
                    }
                  >
                    LOAD
                  </button>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </div>

      <p className="run-note">
        RUNS ON {model ? model.toUpperCase() : 'NO MODEL'} · IDEAS ARE SAVED AS SOON AS THEY ARRIVE
      </p>
    </div>
  );
}

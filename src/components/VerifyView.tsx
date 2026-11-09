import { useState } from 'react';
import { FieldLabel } from './ui';

interface VerifyViewProps {
  busy: boolean;
  model: string;
  githubQueries: number;
  onVerify: (description: string, stack: string) => void;
}

export function VerifyView({ busy, model, githubQueries, onVerify }: VerifyViewProps) {
  const [description, setDescription] = useState('');
  const [stack, setStack] = useState('');
  const ready = description.trim().length >= 30 && !busy && Boolean(model);

  return (
    <div className="view verify-view rise">
      <header className="view-head">
        <span className="eyebrow">02 / ANALYZE</span>
        <h1 className="display">Is it already out there?</h1>
        <p className="lede">
          Paste the idea as you would explain it to an engineer. The scan reads GitHub, general web
          results and Hacker News, then grades what it finds for completeness and actual usage.
        </p>
      </header>

      <div className="verify-grid">
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onVerify(description, stack);
          }}
        >
          <div className="panel-head">
            <span>THE IDEA</span>
            <span className="panel-meta">PLAIN TEXT</span>
          </div>
          <div className="panel-body">
            <label className="field">
              <FieldLabel
                text="DESCRIPTION"
                hint="who it is for, what it does, the core mechanic"
              />
              <textarea
                rows={10}
                value={description}
                placeholder="A local-first specimen catalog for small natural history labs. Researchers photograph and label finds offline, then publish verified records with provenance to a shared public index…"
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <label className="field">
              <FieldLabel text="TECH STACK" hint="optional, but it sharpens the search" optional />
              <input
                value={stack}
                placeholder="Electron, SQLite, S3-compatible storage"
                onChange={(event) => setStack(event.target.value)}
              />
            </label>

            <div className="verify-actions">
              <button type="submit" className="btn primary" disabled={!ready}>
                {busy ? 'SCANNING…' : 'SCAN BEFORE YOU BUILD →'}
              </button>
              <span className="fineprint">
                {model ? `MODEL / ${model.toUpperCase()}` : 'NO MODEL SELECTED'} · UP TO{' '}
                {githubQueries} GITHUB QUERIES · ABOUT 1–2 MINUTES
              </span>
            </div>
            <p className="fineprint">
              The description is filed as a new idea, so the report and its evidence stay in the
              workspace. Scans use public endpoints; your idea text stays on this machine.
            </p>
          </div>
        </form>

        <aside className="panel method-panel">
          <div className="panel-head">
            <span>METHOD</span>
            <span className="panel-meta">LOCAL + PUBLIC DATA</span>
          </div>
          <div className="panel-body">
            <ol className="method-list">
              <li>
                <span>01</span>
                <div>
                  <strong>Translate</strong>
                  <p>
                    The local model turns your idea into search phrasings that do not depend on the
                    name you gave it.
                  </p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Search</strong>
                  <p>
                    Repository search on GitHub, general web results, and Hacker News launches are
                    collected as evidence with stars, dates and activity. A connected GitHub token
                    raises the scan from 3 to 10 queries.
                  </p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Grade</strong>
                  <p>
                    The model marks each match direct, adjacent or loose, then estimates whether it
                    is shipped, beta, prototype or abandoned.
                  </p>
                </div>
              </li>
            </ol>
            <p className="fineprint">
              Usage comes from hard signals: stars, fork counts, organization ownership, and Hacker
              News points. Completeness is an estimate from that evidence, not an audit.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

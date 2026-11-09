import { useEffect, useRef, useState } from 'react';
import type { AppState, CacheInfo, GitHubAuthStatus, Idea, Settings, ViewName } from '../shared/types';
import { Composer } from './components/Composer';
import { IdeaView } from './components/IdeaView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { VerifyView } from './components/VerifyView';
import { NoticeBar, TaskStrip } from './components/ui';
import { deriveTitle, errorText, pickDefaultModel, promptSignature, uid } from './lib/util';
import type { Brief } from './lib/util';

interface TaskState {
  taskId: string;
  kind: 'generate' | 'scan';
  stage: string;
  label: string;
  received?: number;
}

interface NoticeState {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [ollama, setOllama] = useState<{ ok: boolean; error?: string }>({ ok: false });
  const [github, setGithub] = useState<GitHubAuthStatus>({
    connected: false,
    limit: 10,
    queriesPerScan: 3,
  });
  const [cache, setCache] = useState<CacheInfo>({ entries: 0, bytes: 0 });
  const [dataPath, setDataPath] = useState('');
  const [bootError, setBootError] = useState<string | null>(null);
  const [task, setTask] = useState<TaskState | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState<Brief>({ themes: '', goals: '', stack: '', count: 3 });

  const hydrated = useRef(false);
  const stateRef = useRef<AppState | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const noticeSeq = useRef(0);

  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await window.softwareProjectAnalyzer.bootstrap();
        if (cancelled) return;
        const next = payload.state;
        if (!next.settings.model || !payload.models.includes(next.settings.model)) {
          next.settings.model = pickDefaultModel(payload.models);
        }
        setModels(payload.models);
        setDataPath(payload.dataPath);
        setOllama({ ok: payload.ollamaOk, error: payload.ollamaError });
        setGithub(payload.github);
        setCache(payload.cache);
        setState(next);
        const latest = [...next.prompts].sort((a, b) => b.lastRunAt - a.lastRunAt)[0];
        if (latest) {
          setDraft({
            themes: latest.themes,
            goals: latest.goals,
            stack: latest.stack,
            count: latest.count,
          });
        }
        hydrated.current = true;
      } catch (error) {
        if (!cancelled) setBootError(errorText(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      window.softwareProjectAnalyzer.onProgress((event) => {
        if (event.taskId !== taskIdRef.current) return;
        setTask((current) =>
          current
            ? { ...current, stage: event.stage, label: event.label, received: event.received }
            : current,
        );
      }),
    [],
  );

  useEffect(() => {
    if (!state || !hydrated.current) return;
    const handle = setTimeout(() => {
      void window.softwareProjectAnalyzer.saveState(state).catch(() => undefined);
    }, 450);
    return () => clearTimeout(handle);
  }, [state]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.kind === 'error' ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const notify = (kind: 'info' | 'error', text: string) => {
    noticeSeq.current += 1;
    setNotice({ id: noticeSeq.current, kind, text });
  };

  const updateState = (updater: (current: AppState) => AppState) => {
    setState((current) => (current ? updater(current) : current));
  };

  const setView = (view: ViewName) => {
    updateState((current) => ({ ...current, ui: { ...current.ui, view } }));
  };

  const selectIdea = (id: string) => {
    updateState((current) => ({ ...current, ui: { ...current.ui, view: 'idea', ideaId: id } }));
  };

  const updateIdea = (id: string, patch: Partial<Idea>) => {
    updateState((current) => ({
      ...current,
      ideas: current.ideas.map((idea) =>
        idea.id === id ? { ...idea, ...patch, updatedAt: Date.now() } : idea,
      ),
    }));
  };

  const deleteIdea = (id: string) => {
    updateState((current) => {
      const ideas = current.ideas.filter((idea) => idea.id !== id);
      if (current.ui.ideaId !== id) return { ...current, ideas };
      return {
        ...current,
        ideas,
        ui: {
          ...current.ui,
          ideaId: ideas[0]?.id ?? null,
          view: ideas.length === 0 ? 'generate' : current.ui.view,
        },
      };
    });
  };

  const moveIdea = (ideaId: string, folderId: string | null) => {
    updateIdea(ideaId, { folderId });
  };

  const createFolder = (name: string) => {
    updateState((current) => ({
      ...current,
      folders: [
        ...current.folders,
        { id: uid(), name: name.slice(0, 60), collapsed: false },
      ],
    }));
  };

  const renameFolder = (id: string, name: string) => {
    updateState((current) => ({
      ...current,
      folders: current.folders.map((folder) =>
        folder.id === id ? { ...folder, name: name.slice(0, 60) } : folder,
      ),
    }));
  };

  const deleteFolder = (id: string) => {
    updateState((current) => ({
      ...current,
      folders: current.folders.filter((folder) => folder.id !== id),
      ideas: current.ideas.map((idea) =>
        idea.folderId === id ? { ...idea, folderId: null, updatedAt: Date.now() } : idea,
      ),
    }));
  };

  const toggleFolder = (id: string) => {
    updateState((current) => ({
      ...current,
      folders: current.folders.map((folder) =>
        folder.id === id ? { ...folder, collapsed: !folder.collapsed } : folder,
      ),
    }));
  };

  const deletePrompt = (id: string) => {
    updateState((current) => ({
      ...current,
      prompts: current.prompts.filter((prompt) => prompt.id !== id),
    }));
  };

  const runPrompt = async (brief: Brief) => {
    const current = stateRef.current;
    if (!current) return;
    if (!brief.themes.trim() && !brief.goals.trim()) {
      notify('error', 'Add a theme or a goal first.');
      return;
    }
    if (!current.settings.model) {
      notify('error', 'No Ollama model selected. Open Settings and choose one.');
      return;
    }
    if (taskIdRef.current) {
      notify('info', 'One run at a time — wait for the current task to finish.');
      return;
    }

    const taskId = uid();
    taskIdRef.current = taskId;
    setTask({ taskId, kind: 'generate', stage: 'drafting', label: 'Drafting ideas…' });

    try {
      const drafts = await window.softwareProjectAnalyzer.generate({
        taskId,
        themes: brief.themes,
        goals: brief.goals,
        stack: brief.stack,
        count: brief.count,
        model: current.settings.model,
        host: current.settings.host,
        avoid: current.ideas
          .filter((idea) => idea.kind === 'generated')
          .slice(0, 60)
          .map((idea) => idea.title),
      });

      const now = Date.now();
      const incoming: Idea[] = drafts.map((draftIdea, index) => ({
        ...draftIdea,
        id: uid(),
        kind: 'generated',
        folderId: null,
        model: current.settings.model,
        createdAt: now + index,
        updatedAt: now + index,
      }));

      const signature = promptSignature(brief);
      const promptId =
        current.prompts.find((prompt) => promptSignature(prompt) === signature)?.id ?? uid();
      const ideasWithPrompt = incoming.map((idea) => ({ ...idea, promptId }));

      updateState((latest) => ({
        ...latest,
        prompts: latest.prompts.some((prompt) => prompt.id === promptId)
          ? latest.prompts.map((prompt) =>
              prompt.id === promptId
                ? { ...prompt, runs: prompt.runs + 1, lastRunAt: now }
                : prompt,
            )
          : [
              {
                id: promptId,
                themes: brief.themes,
                goals: brief.goals,
                stack: brief.stack,
                count: brief.count,
                runs: 1,
                createdAt: now,
                lastRunAt: now,
              },
              ...latest.prompts,
            ],
        ideas: [...ideasWithPrompt, ...latest.ideas],
        ui: {
          ...latest.ui,
          view: 'idea',
          ideaId: ideasWithPrompt[0]?.id ?? latest.ui.ideaId,
        },
      }));

      notify(
        'info',
        `${incoming.length} idea${incoming.length === 1 ? '' : 's'} added to the workspace.`,
      );
    } catch (error) {
      notify('error', errorText(error));
    } finally {
      taskIdRef.current = null;
      setTask(null);
    }
  };

  const runScan = async (idea: Idea, fresh = false) => {
    const current = stateRef.current;
    if (!current) return;
    if (!current.settings.model) {
      notify('error', 'No Ollama model selected. Open Settings and choose one.');
      return;
    }
    if (taskIdRef.current) {
      notify('info', 'One run at a time — wait for the current task to finish.');
      return;
    }

    const taskId = uid();
    taskIdRef.current = taskId;
    setTask({ taskId, kind: 'scan', stage: 'queries', label: 'Planning searches…' });

    try {
      const report = await window.softwareProjectAnalyzer.research({
        taskId,
        ideaId: idea.id,
        title: idea.title,
        description: idea.description,
        stack: idea.techStack.map((item) => item.name),
        model: current.settings.model,
        host: current.settings.host,
        fresh,
      });
      updateIdea(idea.id, { report });
      void window.softwareProjectAnalyzer.cacheStats().then(setCache).catch(() => undefined);
      notify(
        'info',
        `Project scan finished: ${report.findings.length} match${
          report.findings.length === 1 ? '' : 'es'
        }${report.cacheHits ? ` · ${report.cacheHits} cached` : ''}.`,
      );
    } catch (error) {
      notify('error', errorText(error));
    } finally {
      taskIdRef.current = null;
      setTask(null);
    }
  };

  const verifyIdea = async (description: string, stackLine: string) => {
    const current = stateRef.current;
    if (!current) return;
    const trimmed = description.trim();
    if (trimmed.length < 30) {
      notify('error', 'Add a bit more detail so the scan has something to work with.');
      return;
    }
    if (taskIdRef.current) {
      notify('info', 'One run at a time — wait for the current task to finish.');
      return;
    }

    const now = Date.now();
    const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0] ?? trimmed;
    const idea: Idea = {
      id: uid(),
      kind: 'verified',
      title: deriveTitle(trimmed),
      oneLiner: firstSentence.replace(/\s+/g, ' ').slice(0, 180),
      description: trimmed,
      techStack: stackLine
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 10)
        .map((name) => ({ name, role: '' })),
      folderId: null,
      model: current.settings.model,
      createdAt: now,
      updatedAt: now,
    };

    updateState((latest) => ({
      ...latest,
      ideas: [idea, ...latest.ideas],
      ui: { ...latest.ui, view: 'idea', ideaId: idea.id },
    }));

    await runScan(idea);
  };

  const changeSettings = (patch: Partial<Settings>) => {
    updateState((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
  };

  const refreshModels = async (host: string) => {
    const trimmed = host.trim();
    if (trimmed) changeSettings({ host: trimmed });
    const result = await window.softwareProjectAnalyzer.listModels(trimmed);
    setModels(result.models);
    setOllama({ ok: result.ok, error: result.error });
    if (!result.ok) {
      notify('error', result.error ?? 'Could not reach Ollama.');
      return;
    }
    const active = stateRef.current?.settings.model ?? '';
    if (result.models.length > 0 && !result.models.includes(active)) {
      const fallback = pickDefaultModel(result.models);
      changeSettings({ model: fallback });
      notify('info', `Model set to ${fallback}.`);
    } else {
      notify(
        'info',
        `${result.models.length} local model${result.models.length === 1 ? '' : 's'} found.`,
      );
    }
  };

  const connectGithub = async (token: string): Promise<boolean> => {
    try {
      const result = await window.softwareProjectAnalyzer.connectGitHub(token);
      setGithub(result.status);
      if (!result.ok) {
        notify('error', result.error ?? 'GitHub could not be connected.');
        return false;
      }
      notify(
        'info',
        `GitHub connected as @${result.status.login}. Scans can use up to ${result.status.queriesPerScan} queries at ${result.status.limit}/minute.`,
      );
      return true;
    } catch (error) {
      notify('error', errorText(error));
      return false;
    }
  };

  const disconnectGithub = async (): Promise<void> => {
    try {
      const status = await window.softwareProjectAnalyzer.disconnectGitHub();
      setGithub(status);
      notify('info', 'GitHub token removed. Scans are back to the anonymous limit.');
    } catch (error) {
      notify('error', errorText(error));
    }
  };

  const refreshGithub = async (): Promise<void> => {
    try {
      const status = await window.softwareProjectAnalyzer.refreshGitHub();
      setGithub(status);
      if (status.error) notify('error', status.error);
      else if (status.connected) {
        notify('info', `GitHub search remaining this minute: ${status.remaining ?? 'unknown'}.`);
      }
    } catch (error) {
      notify('error', errorText(error));
    }
  };

  const exportWorkspace = async (): Promise<void> => {
    const current = stateRef.current;
    if (!current) return;
    try {
      const result = await window.softwareProjectAnalyzer.exportWorkspace(current);
      if (result.ok) notify('info', `Workspace backup saved to ${result.path}.`);
      else if (!result.canceled) notify('error', result.error ?? 'Could not export the workspace.');
    } catch (error) {
      notify('error', errorText(error));
    }
  };

  const importWorkspace = async (): Promise<void> => {
    if (taskIdRef.current) {
      notify('info', 'Wait for the current task to finish before importing a backup.');
      return;
    }
    let result;
    try {
      result = await window.softwareProjectAnalyzer.importWorkspace();
    } catch (error) {
      notify('error', errorText(error));
      return;
    }
    if (!result.ok || !result.state) {
      if (!result.canceled) notify('error', result.error ?? 'Could not import that backup.');
      return;
    }

    const imported = result.state;
    const refreshed = await window.softwareProjectAnalyzer.listModels(imported.settings.host);
    if (refreshed.ok) {
      setModels(refreshed.models);
      setOllama({ ok: true });
      if (!imported.settings.model || !refreshed.models.includes(imported.settings.model)) {
        imported.settings.model = pickDefaultModel(refreshed.models);
      }
    } else {
      setOllama({ ok: false, error: refreshed.error });
    }
    setState(imported);
    setFilter('');
    notify(
      'info',
      `Workspace restored: ${imported.ideas.length} ideas and ${imported.prompts.length} saved briefs.`,
    );
  };

  const clearCache = async (): Promise<CacheInfo> => {
    try {
      const stats = await window.softwareProjectAnalyzer.clearCache();
      setCache(stats);
      notify('info', 'Research cache cleared.');
      return stats;
    } catch (error) {
      notify('error', errorText(error));
      return cache;
    }
  };

  const openExternal = (url: string) => {
    void window.softwareProjectAnalyzer.openExternal(url).catch(() => undefined);
  };

  if (bootError) {
    return (
      <div className="boot boot-error">
        <span className="brand-name">SOFTWARE PROJECT ANALYZER</span>
        <p>{bootError}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          RETRY
        </button>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="boot">
        <span className="brand-mark" aria-hidden="true">
          ▚
        </span>
        <span className="brand-name">SOFTWARE PROJECT ANALYZER</span>
        <span className="boot-sub">opening the workspace…</span>
      </div>
    );
  }

  const selected = state.ideas.find((idea) => idea.id === state.ui.ideaId) ?? null;
  const view: ViewName =
    state.ui.view === 'idea' && !selected ? 'generate' : state.ui.view;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ▚
          </span>
          <span className="brand-name">SOFTWARE PROJECT ANALYZER</span>
          <span className="brand-sub">project workspace</span>
        </div>
        <nav className="nav" aria-label="Views">
          {(
            [
              ['generate', '01', 'GENERATE'],
              ['verify', '02', 'ANALYZE'],
              ['settings', '03', 'SETTINGS'],
            ] as const
          ).map(([name, index, label]) => (
            <button
              key={name}
              type="button"
              className={view === name ? 'is-active' : ''}
              onClick={() => setView(name)}
            >
              <span>{index}</span>
              {label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className={`model-chip ${ollama.ok ? 'is-ok' : 'is-down'}`}
          onClick={() => setView('settings')}
          title={ollama.error ?? 'Open settings'}
        >
          <span className="dot" aria-hidden="true" />
          {state.settings.model || 'NO MODEL'}
        </button>
      </header>

      {task ? <TaskStrip task={task} /> : null}

      <div className="shell">
        <Sidebar
          ideas={state.ideas}
          folders={state.folders}
          selectedId={view === 'idea' ? state.ui.ideaId : null}
          filter={filter}
          onFilter={setFilter}
          onSelectIdea={selectIdea}
          onCreateFolder={createFolder}
          onRenameFolder={renameFolder}
          onDeleteFolder={deleteFolder}
          onToggleFolder={toggleFolder}
          onMoveIdea={moveIdea}
        />

        <main className="stage">
          {view === 'generate' ? (
            <Composer
              draft={draft}
              prompts={state.prompts}
              busy={Boolean(task)}
              model={state.settings.model}
              onDraft={(patch) => setDraft((current) => ({ ...current, ...patch }))}
              onRun={runPrompt}
              onDeletePrompt={deletePrompt}
            />
          ) : null}

          {view === 'verify' ? (
            <VerifyView
              busy={Boolean(task)}
              model={state.settings.model}
              githubQueries={github.queriesPerScan}
              onVerify={verifyIdea}
            />
          ) : null}

          {view === 'idea' && selected ? (
            <IdeaView
              idea={selected}
              folders={state.folders}
              prompts={state.prompts}
              scanning={task?.kind === 'scan'}
              busy={Boolean(task)}
              onScan={() => void runScan(selected, Boolean(selected.report))}
              onDelete={() => deleteIdea(selected.id)}
              onMove={(folderId) => moveIdea(selected.id, folderId)}
              onOpenExternal={openExternal}
            />
          ) : null}

          {view === 'settings' ? (
            <SettingsView
              settings={state.settings}
              models={models}
              ollama={ollama}
              dataPath={dataPath}
              ideaCount={state.ideas.length}
              folderCount={state.folders.length}
              promptCount={state.prompts.length}
              github={github}
              cache={cache}
              busy={Boolean(task)}
              onChange={changeSettings}
              onRefresh={(host) => void refreshModels(host)}
              onGithubConnect={connectGithub}
              onGithubDisconnect={disconnectGithub}
              onGithubRefresh={refreshGithub}
              onExportWorkspace={exportWorkspace}
              onImportWorkspace={importWorkspace}
              onClearCache={clearCache}
              onOpenExternal={openExternal}
              onNotify={notify}
            />
          ) : null}
        </main>
      </div>

      {notice ? <NoticeBar notice={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  );
}

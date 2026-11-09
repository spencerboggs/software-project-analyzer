import { useEffect, useState, type DragEvent } from 'react';
import type { Folder, Idea } from '../../shared/types';

interface SidebarProps {
  ideas: Idea[];
  folders: Folder[];
  selectedId: string | null;
  filter: string;
  onFilter: (value: string) => void;
  onSelectIdea: (id: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onMoveIdea: (ideaId: string, folderId: string | null) => void;
}

function IdeaTab({
  idea,
  active,
  onSelect,
}: {
  idea: Idea;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`idea-tab ${active ? 'is-active' : ''}`}
      title={idea.oneLiner || idea.title}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/idea-id', idea.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onSelect}
    >
      <span className={`idea-kind ${idea.kind}`} aria-hidden="true" />
      <span className="idea-title">{idea.title}</span>
      <span className="idea-state" title={idea.report ? 'Project scanned' : 'Not scanned yet'}>
        {idea.report ? '✓' : ''}
      </span>
    </button>
  );
}

export function Sidebar({
  ideas,
  folders,
  selectedId,
  filter,
  onFilter,
  onSelectIdea,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onMoveIdea,
}: SidebarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmId) return;
    const timer = setTimeout(() => setConfirmId(null), 3500);
    return () => clearTimeout(timer);
  }, [confirmId]);

  const query = filter.trim().toLowerCase();
  const visible = query
    ? ideas.filter((idea) =>
        [idea.title, idea.oneLiner, idea.description, ...idea.techStack.map((item) => item.name)]
          .join(' ')
          .toLowerCase()
          .includes(query),
      )
    : ideas;

  const knownFolderIds = new Set(folders.map((folder) => folder.id));
  const unfiled = visible.filter((idea) => !idea.folderId || !knownFolderIds.has(idea.folderId));

  const dropHandlers = (folderId: string | null) => ({
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setOverId(folderId ?? 'unfiled');
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setOverId((current) => (current === (folderId ?? 'unfiled') ? null : current));
      }
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const id = event.dataTransfer.getData('text/idea-id');
      setOverId(null);
      if (id) onMoveIdea(id, folderId);
    },
  });

  return (
    <aside className="rail" aria-label="Project workspace">
      <div className="rail-head">
        <span className="rail-title">WORKSPACE</span>
        <span className="rail-count">{ideas.length}</span>
      </div>

      <input
        className="rail-filter"
        type="search"
        value={filter}
        placeholder="FILTER IDEAS"
        aria-label="Filter ideas"
        onChange={(event) => onFilter(event.target.value)}
      />

      <div className="rail-scroll">
        <div className={`folder unfiled ${overId === 'unfiled' ? 'is-drop' : ''}`} {...dropHandlers(null)}>
          <div className="folder-head">
            <div className="folder-toggle folder-toggle-static">
              <span className="folder-name">UNFILED</span>
              <span className="folder-count">{unfiled.length}</span>
            </div>
          </div>
          <div className="folder-items">
            {unfiled.map((idea) => (
              <IdeaTab
                key={idea.id}
                idea={idea}
                active={idea.id === selectedId}
                onSelect={() => onSelectIdea(idea.id)}
              />
            ))}
            {unfiled.length === 0 && (query || ideas.length > 0) ? (
              <p className="rail-empty">{query ? 'No matches here.' : 'New ideas land here.'}</p>
            ) : null}
          </div>
        </div>

        {folders.map((folder) => {
          const items = visible.filter((idea) => idea.folderId === folder.id);
          if (query && items.length === 0) return null;
          return (
            <div
              key={folder.id}
              className={`folder ${overId === folder.id ? 'is-drop' : ''}`}
              {...dropHandlers(folder.id)}
            >
              <div className="folder-head">
                <button
                  type="button"
                  className="folder-toggle"
                  aria-expanded={!folder.collapsed}
                  onClick={() => onToggleFolder(folder.id)}
                >
                  <span className={`chev ${folder.collapsed ? 'is-closed' : ''}`} aria-hidden="true">
                    ▾
                  </span>
                  <span className="folder-name">{folder.name}</span>
                  <span className="folder-count">{items.length}</span>
                </button>
                <div className="folder-tools">
                  <button
                    type="button"
                    className="icon-btn"
                    title="Rename folder"
                    aria-label={`Rename folder ${folder.name}`}
                    onClick={() => {
                      setEditingId(folder.id);
                      setEditName(folder.name);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className={`icon-btn ${confirmId === folder.id ? 'is-confirm' : ''}`}
                    title={confirmId === folder.id ? 'Click again to delete' : 'Delete folder'}
                    aria-label={`Delete folder ${folder.name}`}
                    onClick={() => {
                      if (confirmId === folder.id) {
                        onDeleteFolder(folder.id);
                        setConfirmId(null);
                      } else {
                        setConfirmId(folder.id);
                      }
                    }}
                  >
                    {confirmId === folder.id ? 'SURE' : '×'}
                  </button>
                </div>
              </div>

              {editingId === folder.id ? (
                <form
                  className="folder-edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = editName.trim();
                    if (name) onRenameFolder(folder.id, name);
                    setEditingId(null);
                  }}
                >
                  <input
                    autoFocus
                    value={editName}
                    aria-label="Folder name"
                    onChange={(event) => setEditName(event.target.value)}
                    onBlur={() => setEditingId(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                  />
                </form>
              ) : (
                !folder.collapsed && (
                  <div className="folder-items">
                    {items.map((idea) => (
                      <IdeaTab
                        key={idea.id}
                        idea={idea}
                        active={idea.id === selectedId}
                        onSelect={() => onSelectIdea(idea.id)}
                      />
                    ))}
                    {items.length === 0 ? <p className="rail-empty">Drop ideas here.</p> : null}
                  </div>
                )
              )}
            </div>
          );
        })}

        {ideas.length === 0 && !query ? (
          <p className="rail-empty rail-empty-large">
            Nothing filed yet. Generate a batch, then drag ideas into folders.
          </p>
        ) : null}
      </div>

      <div className="rail-foot">
        {creating ? (
          <form
            className="folder-create"
            onSubmit={(event) => {
              event.preventDefault();
              const name = newName.trim();
              if (name) onCreateFolder(name);
              setNewName('');
              setCreating(false);
            }}
          >
            <input
              autoFocus
              value={newName}
              aria-label="New folder name"
              placeholder="FOLDER NAME"
              onChange={(event) => setNewName(event.target.value)}
              onBlur={() => setCreating(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setCreating(false);
              }}
            />
          </form>
        ) : (
          <button type="button" className="rail-new" onClick={() => setCreating(true)}>
            + NEW FOLDER
          </button>
        )}
        <span className="rail-foot-meta">
          {folders.length} FOLDER{folders.length === 1 ? '' : 'S'}
        </span>
      </div>
    </aside>
  );
}

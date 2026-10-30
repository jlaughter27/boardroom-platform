import { useState, useEffect, useMemo, Suspense } from 'react';
import type { Memory } from '@boardroom/shared';
import { MemoryClass, MemoryStatus, Confidence } from '@boardroom/shared';
import { useMemoryStore } from '../../stores/memory.store';
import * as api from '../../lib/api';
import type { MemoryEntityLink } from '../../lib/api';
import { EntityLinker } from './EntityLinker';
import { LazyMemoryMarkdown } from './memory-markdown-loader';
import { MemoryBacklinks } from './MemoryBacklinks';
import { MemoryPlainText } from './MemoryPlainText';
import { useMemoryWikilinks } from './use-memory-wikilinks';
import { markdownRenderGuard, stripLeadingTitleHeading } from '../../lib/markdown';

interface MemoryDetailProps {
  memory: Memory;
}

function relativeTime(date: Date | string | null): string {
  if (!date) return 'N/A';
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatDate(date: Date | string | null): string {
  if (!date) return 'N/A';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: 'bg-info-muted text-info border-info/30',
  goal: 'bg-success-muted text-success border-success/30',
  project: 'bg-primary/10 text-primary-text border-primary/30',
};

/** Placeholder while the markdown renderer chunk loads (first open only). */
function MarkdownSkeleton() {
  return (
    <div className="mt-2 space-y-2 animate-pulse" aria-hidden="true" data-testid="memory-markdown-loading">
      <div className="h-3 w-5/6 rounded bg-muted" />
      <div className="h-3 w-full rounded bg-muted" />
      <div className="h-3 w-2/3 rounded bg-muted" />
    </div>
  );
}

export function MemoryDetail({ memory }: MemoryDetailProps) {
  const { updateMemory, archiveMemory } = useMemoryStore();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(memory.title);
  const [content, setContent] = useState(memory.content);
  const [importance, setImportance] = useState(memory.importance);
  const [tags, setTags] = useState(memory.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // Related memories state
  const [relatedMemories, setRelatedMemories] = useState<Memory[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);

  // Linked entities state
  const [entityLinks, setEntityLinks] = useState<MemoryEntityLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [showLinker, setShowLinker] = useState(false);

  // Reset form when memory changes
  if (title !== memory.title && !editing) {
    setTitle(memory.title);
    setContent(memory.content);
    setImportance(memory.importance);
    setTags(memory.tags.join(', '));
  }

  // Fetch related memories
  useEffect(() => {
    if (!memory.domain) return;
    setLoadingRelated(true);
    api.listMemories({ domain: memory.domain, limit: 5 }).then(result => {
      // Filter out the current memory
      const related = (result.items || []).filter((m: Memory) => m.id !== memory.id);
      setRelatedMemories(related.slice(0, 5));
      setLoadingRelated(false);
    }).catch(() => setLoadingRelated(false));
  }, [memory.id, memory.domain]);

  // Fetch entity links
  useEffect(() => {
    setLoadingLinks(true);
    api.getMemoryLinks(memory.id).then(links => {
      setEntityLinks(links);
      setLoadingLinks(false);
    }).catch(() => setLoadingLinks(false));
  }, [memory.id]);

  // RD-1: [[wikilinks]] resolve through the outgoing link rows, then by title.
  const { resolve: resolveWikilink, open: openMemory, byId: linkedById } = useMemoryWikilinks(memory, entityLinks);
  const renderGuard = useMemo(() => markdownRenderGuard(memory.content), [memory.content]);

  function refreshLinks() {
    api.getMemoryLinks(memory.id).then(links => {
      setEntityLinks(links);
    }).catch(() => { /* ignore */ });
  }

  async function handleDeleteLink(linkId: string) {
    try {
      await api.deleteMemoryLink(memory.id, linkId);
      setEntityLinks(prev => prev.filter(l => l.id !== linkId));
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateMemory(memory.id, {
        title,
        content,
        importance,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setEditing(false);
    } catch {
      // error already logged in store
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    try {
      await archiveMemory(memory.id);
    } catch {
      // error already logged in store
    }
    setConfirmArchive(false);
  }

  function handleCancelEdit() {
    setTitle(memory.title);
    setContent(memory.content);
    setImportance(memory.importance);
    setTags(memory.tags.join(', '));
    setEditing(false);
  }

  const sessionLink =
    memory.sourceRef?.startsWith('session:')
      ? `/decisions/${memory.sourceRef.slice(8)}`
      : null;

  const labelClass = 'text-[11px] font-medium text-muted-foreground uppercase tracking-wider';
  const valueClass = 'text-sm text-muted-foreground';

  return (
    <div className="min-w-0 space-y-4 overflow-y-auto" data-testid="memory-detail">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 bg-card border border-border rounded px-3 py-1.5 text-lg font-bold text-foreground focus:outline-none focus:border-primary/40"
          />
        ) : (
          <h2
            data-memory-title
            tabIndex={-1}
            className="min-w-0 flex-1 break-words text-lg font-bold text-foreground focus:outline-none"
          >
            {memory.title}
          </h2>
        )}

        <div className="flex gap-1.5 shrink-0">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1 bg-primary hover:bg-primary-hover disabled:opacity-50 text-primary-foreground text-xs rounded transition-colors"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1 bg-muted hover:bg-primary hover:text-primary-foreground text-muted-foreground text-xs rounded transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1 bg-muted hover:bg-primary hover:text-primary-foreground text-muted-foreground text-xs rounded transition-colors"
              >
                Edit
              </button>
              {!confirmArchive ? (
                <button
                  onClick={() => setConfirmArchive(true)}
                  className="px-3 py-1 bg-muted hover:bg-destructive/10 text-muted-foreground hover:text-destructive text-xs rounded transition-colors"
                >
                  Archive
                </button>
              ) : (
                <div className="flex gap-1">
                  <button
                    onClick={handleArchive}
                    className="px-3 py-1 bg-destructive hover:bg-destructive/90 text-foreground text-xs rounded transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmArchive(false)}
                    className="px-3 py-1 bg-muted hover:bg-primary hover:text-primary-foreground text-muted-foreground text-xs rounded transition-colors"
                  >
                    No
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div>
        <p className={labelClass}>Content</p>
        {editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="w-full mt-1 bg-card border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/40 resize-y"
          />
        ) : renderGuard.plain ? (
          // M7: very large or pathological content would freeze the tab in the markdown parser.
          <MemoryPlainText className="mt-1" content={memory.content ?? ''} />
        ) : (
          <Suspense fallback={<MarkdownSkeleton />}>
            <LazyMemoryMarkdown
              className="mt-1"
              content={stripLeadingTitleHeading(memory.content ?? '', memory.title)}
              resolve={resolveWikilink}
              onOpen={openMemory}
            />
          </Suspense>
        )}
      </div>

      {/* Two-column info grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <p className={labelClass}>Domain</p>
          <p className={valueClass}>{memory.domain}</p>
        </div>
        <div>
          <p className={labelClass}>Sector</p>
          <p className={valueClass}>{memory.sector || 'N/A'}</p>
        </div>
        <div>
          <p className={labelClass}>Memory Class</p>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
              {
                [MemoryClass.WORKING]:
                  'bg-primary/10 text-primary-text border-primary/30',
                [MemoryClass.EPISODIC]:
                  'bg-info-muted text-info border-info/30',
                [MemoryClass.SEMANTIC]:
                  'bg-info-muted text-info border-info/30',
                [MemoryClass.DECISION]:
                  'bg-warning-muted text-warning border-warning/30',
              }[memory.memoryClass] ?? 'bg-card text-muted-foreground border-border'
            }`}
          >
            {memory.memoryClass}
          </span>
        </div>
        <div>
          <p className={labelClass}>Status</p>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
              {
                [MemoryStatus.CONFIRMED]:
                  'bg-success-muted text-success border-success/30',
                [MemoryStatus.DRAFT]:
                  'bg-warning-muted text-warning border-warning/30',
                [MemoryStatus.ARCHIVED]:
                  'bg-card text-muted-foreground border-border',
                [MemoryStatus.SUPERSEDED]:
                  'bg-warning-muted text-warning border-warning/30',
                [MemoryStatus.REJECTED]:
                  'bg-destructive/10 text-destructive border-destructive/30',
              }[memory.status] ?? 'bg-card text-muted-foreground border-border'
            }`}
          >
            {memory.status}
          </span>
        </div>
        <div>
          <p className={labelClass}>Confidence</p>
          <span
            className={`text-sm font-medium ${
              {
                [Confidence.HIGH]: 'text-success',
                [Confidence.MEDIUM]: 'text-warning',
                [Confidence.LOW]: 'text-orange-400',
                [Confidence.SPECULATIVE]: 'text-destructive',
              }[memory.confidence] ?? 'text-muted-foreground'
            }`}
          >
            {memory.confidence}
          </span>
        </div>
        <div>
          <p className={labelClass}>Importance</p>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={importance}
                onChange={(e) => setImportance(Number(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <span className="text-sm text-muted-foreground w-10 text-right">
                {(importance * 100).toFixed(0)}%
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${memory.importance * 100}%` }}
                />
              </div>
              <span className="text-sm text-muted-foreground">
                {(memory.importance * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>
        <div>
          <p className={labelClass}>Source Type</p>
          <p className={valueClass}>{memory.sourceType}</p>
        </div>
        <div>
          <p className={labelClass}>Source Ref</p>
          {sessionLink ? (
            <a
              href={sessionLink}
              className="text-sm text-info hover:text-foreground underline"
            >
              Session {memory.sourceRef!.slice(8, 16)}...
            </a>
          ) : (
            <p className={valueClass}>{memory.sourceRef ?? 'N/A'}</p>
          )}
        </div>
        <div>
          <p className={labelClass}>Source Weight</p>
          <p className={valueClass}>{memory.sourceWeight}</p>
        </div>
        <div>
          <p className={labelClass}>Version</p>
          <p className={valueClass}>{memory.version}</p>
        </div>
        <div>
          <p className={labelClass}>Valid At</p>
          <p className={valueClass}>{formatDate(memory.validAt)}</p>
        </div>
        <div>
          <p className={labelClass}>Invalid At</p>
          <p className={valueClass}>{formatDate(memory.invalidAt)}</p>
        </div>
        {memory.supersededBy && (
          <div className="col-span-2">
            <p className={labelClass}>Superseded By</p>
            <p className="text-sm text-info">{memory.supersededBy}</p>
          </div>
        )}
      </div>

      {/* Tags */}
      <div>
        <p className={labelClass}>Tags</p>
        {editing ? (
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Comma-separated tags..."
            className="w-full mt-1 bg-card border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary/40"
          />
        ) : (
          <div className="flex flex-wrap gap-1 mt-1">
            {memory.tags.length > 0 ? (
              memory.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground"
                >
                  {tag}
                </span>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">No tags</span>
            )}
          </div>
        )}
      </div>

      {/* Linked Entities */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <p className={labelClass}>Linked Entities</p>
          <button
            onClick={() => setShowLinker(!showLinker)}
            className="text-xs text-info hover:text-foreground transition-colors"
          >
            {showLinker ? 'Cancel' : 'Link to...'}
          </button>
        </div>

        {loadingLinks ? (
          <p className="text-xs text-muted-foreground">Loading links...</p>
        ) : entityLinks.length === 0 ? (
          <p className="text-xs text-muted-foreground">No linked entities</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {entityLinks.map(link => (
              <span
                key={link.id}
                className={`inline-flex max-w-full items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${
                  ENTITY_TYPE_COLORS[link.entityType] ?? 'bg-card text-muted-foreground border-border'
                }`}
              >
                <span className="max-w-[16rem] truncate">
                  {link.entityType}:{' '}
                  {link.entityType.toLowerCase() === 'memory' && linkedById.get(link.entityId)
                    ? linkedById.get(link.entityId)!.title
                    : `${link.entityId.slice(0, 8)}...`}
                </span>
                <button
                  onClick={() => handleDeleteLink(link.id)}
                  className="ml-0.5 hover:opacity-70"
                  title="Remove link"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}

        {showLinker && (
          <div className="mt-2">
            <EntityLinker
              memoryId={memory.id}
              onLink={() => {
                refreshLinks();
                setShowLinker(false);
              }}
              onClose={() => setShowLinker(false)}
            />
          </div>
        )}
      </div>

      {/* Linked from (backlinks) — RD-1 */}
      <MemoryBacklinks memoryId={memory.id} onOpen={openMemory} labelClass={labelClass} />

      {/* Related Memories */}
      <div className="border-t border-border pt-3">
        <p className={labelClass}>Related Memories</p>
        {loadingRelated ? (
          <p className="text-xs text-muted-foreground mt-1">Loading related...</p>
        ) : relatedMemories.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-1">No related memories found</p>
        ) : (
          <div className="mt-1 space-y-1.5">
            {relatedMemories.map(rm => (
              <div key={rm.id} className="p-2 bg-card rounded text-xs">
                <p className="text-foreground font-medium">{rm.title}</p>
                <p className="text-muted-foreground mt-0.5">
                  {rm.domain} &bull; {rm.tags.slice(0, 3).join(', ') || 'no tags'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timestamps */}
      <div className="border-t border-border pt-3 space-y-1">
        <p className="text-xs text-muted-foreground">
          Created: {formatDate(memory.createdAt)} ({relativeTime(memory.createdAt)})
        </p>
        <p className="text-xs text-muted-foreground">
          Updated: {formatDate(memory.updatedAt)} ({relativeTime(memory.updatedAt)})
        </p>
        <p className="text-xs text-muted-foreground">
          Last accessed: {memory.lastAccessedAt ? `${formatDate(memory.lastAccessedAt)} (${relativeTime(memory.lastAccessedAt)})` : 'Never'}
        </p>
      </div>

      {/* Metadata */}
      {memory.metadata && Object.keys(memory.metadata).length > 0 && (
        <div>
          <p className={labelClass}>Metadata</p>
          <pre className="mt-1 bg-card border border-border rounded p-2 text-xs text-muted-foreground overflow-x-auto">
            {JSON.stringify(memory.metadata, null, 2)}
          </pre>
        </div>
      )}

      {/* Session link */}
      {sessionLink && (
        <p className="text-xs text-muted-foreground">
          Created during{' '}
          <a
            href={sessionLink}
            className="text-info hover:text-foreground underline"
          >
            session {memory.sourceRef!.slice(8)}
          </a>
        </p>
      )}
    </div>
  );
}

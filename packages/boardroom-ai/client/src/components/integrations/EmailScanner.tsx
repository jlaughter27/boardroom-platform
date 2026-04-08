import { useState } from 'react';
import type { EmailSummary, EmailExtraction, EmailMemoryProposal } from '@boardroom/shared';
import * as api from '../../lib/api';

export function EmailScanner() {
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanningId] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<EmailExtraction | null>(null);
  const [selectedProposals, setSelectedProposals] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ created: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function scanEmails() {
    setLoading(true);
    setError(null);
    setExtraction(null);
    setResult(null);
    try {
      const data = await api.getGmailEmails();
      setEmails(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load emails');
    } finally {
      setLoading(false);
    }
  }

  async function extractFromEmail(emailId: string) {
    setScanningId(emailId);
    setError(null);
    setResult(null);
    try {
      const data = await api.extractGmailMemories(emailId);
      setExtraction(data);
      // Select all proposals by default
      setSelectedProposals(new Set(data.proposedMemories.map((_, i) => i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract memories');
    } finally {
      setScanningId(null);
    }
  }

  function toggleProposal(index: number) {
    setSelectedProposals(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function confirmSelected() {
    if (!extraction) return;
    setConfirming(true);
    setError(null);
    try {
      const proposals: EmailMemoryProposal[] = extraction.proposedMemories
        .filter((_, i) => selectedProposals.has(i));
      const data = await api.confirmGmailExtraction(proposals);
      setResult(data);
      setExtraction(null);
      setSelectedProposals(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save memories');
    } finally {
      setConfirming(false);
    }
  }

  const DOMAIN_COLORS: Record<string, string> = {
    business: 'text-info',
    personal: 'text-primary',
    ministry: 'text-amber-400',
    'ai-systems': 'text-success',
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Email Scanner</h3>
        <button
          onClick={scanEmails}
          disabled={loading}
          className="px-3 py-1.5 text-xs bg-primary hover:bg-primary/90 text-foreground rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? 'Scanning...' : 'Scan Recent Emails'}
        </button>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {result && (
        <div className="bg-success-muted border border-green-800 rounded-lg p-3">
          <p className="text-sm text-success">
            {result.created} {result.created === 1 ? 'memory' : 'memories'} saved successfully.
          </p>
        </div>
      )}

      {/* Extraction review panel */}
      {extraction && (
        <div className="bg-card rounded-lg border border-borderp-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-foreground">{extraction.subject}</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                From: {extraction.from} | {new Date(extraction.date).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => { setExtraction(null); setSelectedProposals(new Set()); }}
              className="text-xs text-muted-foreground hover:text-muted-foreground"
            >
              Close
            </button>
          </div>

          {extraction.proposedMemories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No memories worth extracting from this email.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {extraction.proposedMemories.length} proposed {extraction.proposedMemories.length === 1 ? 'memory' : 'memories'} — select which to save:
              </p>
              <div className="space-y-2">
                {extraction.proposedMemories.map((proposal, i) => (
                  <label
                    key={i}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedProposals.has(i)
                        ? 'bg-muted/50 border-primary/40'
                        : 'bg-card border-border opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedProposals.has(i)}
                      onChange={() => toggleProposal(i)}
                      className="mt-0.5 accent-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{proposal.title}</span>
                        <span className={`text-xs ${DOMAIN_COLORS[proposal.domain] ?? 'text-muted-foreground'}`}>
                          {proposal.domain}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{proposal.content}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-xs text-muted-foreground">{proposal.memoryClass}</span>
                        <span className="text-xs text-muted-foreground">|</span>
                        <span className="text-xs text-muted-foreground">
                          Importance: {(proposal.importance * 10).toFixed(0)}/10
                        </span>
                        {proposal.linkedPeople.length > 0 && (
                          <>
                            <span className="text-xs text-muted-foreground">|</span>
                            <span className="text-xs text-muted-foreground">
                              {proposal.linkedPeople.join(', ')}
                            </span>
                          </>
                        )}
                      </div>
                      {proposal.tags.length > 0 && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {proposal.tags.map(tag => (
                            <span key={tag} className="text-xs bg-card text-muted-foreground px-1.5 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={confirmSelected}
                  disabled={confirming || selectedProposals.size === 0}
                  className="px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-foreground rounded-lg transition-colors disabled:opacity-50"
                >
                  {confirming
                    ? 'Saving...'
                    : `Save ${selectedProposals.size} ${selectedProposals.size === 1 ? 'Memory' : 'Memories'}`
                  }
                </button>
                <button
                  onClick={() => { setExtraction(null); setSelectedProposals(new Set()); }}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Email list */}
      {emails.length > 0 && !extraction && (
        <div className="space-y-1">
          {emails.map(email => (
            <div
              key={email.emailId}
              className="flex items-center justify-between bg-card rounded-lg px-4 py-3 hover:bg-card transition-colors"
            >
              <div className="flex-1 min-w-0 mr-3">
                <p className="text-sm text-foreground truncate">{email.subject}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {email.from} | {new Date(email.date).toLocaleDateString()}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{email.snippet}</p>
              </div>
              <button
                onClick={() => extractFromEmail(email.emailId)}
                disabled={scanning === email.emailId}
                className="px-3 py-1.5 text-xs bg-muted hover:bg-accent text-muted-foreground rounded-lg transition-colors disabled:opacity-50 shrink-0"
              >
                {scanning === email.emailId ? 'Extracting...' : 'Extract'}
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && emails.length === 0 && !extraction && (
        <p className="text-sm text-muted-foreground text-center py-6">
          Click "Scan Recent Emails" to load emails from the past 7 days.
        </p>
      )}
    </div>
  );
}

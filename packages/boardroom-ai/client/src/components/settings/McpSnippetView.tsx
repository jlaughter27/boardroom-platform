import type { McpSnippet } from './mcp-snippets';
import { CopyField } from './CopyField';

interface McpSnippetViewProps {
  snippet: McpSnippet;
}

/** Renders one client's install snippet: numbered steps, copyable blocks, footnotes. */
export function McpSnippetView({ snippet }: McpSnippetViewProps) {
  return (
    <section aria-label={`${snippet.title} setup`} data-testid="mcp-snippet" className="space-y-3">
      <h4 className="text-sm font-medium text-foreground">Connect {snippet.title}</h4>
      {snippet.steps.length > 0 && (
        <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
          {snippet.steps.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      )}
      <div className="space-y-3">
        {snippet.blocks.map((block, i) => (
          <CopyField
            key={i}
            label={block.label}
            value={block.code}
            multiline={block.language !== 'text' || block.code.includes('\n')}
            data-testid={`mcp-snippet-block-${i}`}
          />
        ))}
      </div>
      {snippet.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {snippet.notes.map((note, i) => <li key={i}>{note}</li>)}
        </ul>
      )}
    </section>
  );
}

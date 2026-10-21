import { ChevronRight, FolderOpen, ShieldCheck, TreeDeciduous, Upload } from "lucide-react";
import { importData, loadExample, openProject } from "./actions";
import { examples } from "./bundled";
import { Button, Card } from "./ui";

/** Empty state: shown in the workspace while the project has no data. */
export function Welcome() {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <Card className="animate-slide-in w-full max-w-md p-8 shadow-overlay">
        <TreeDeciduous className="size-8 text-accent-text" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Welcome to Linden</h1>
        <p className="mt-1.5 text-sm text-fg-secondary">
          Publication-quality stratigraphic diagrams for palaeoecological data. Start with your own data or explore an example.
        </p>

        <div className="mt-6 flex gap-2">
          <Button variant="primary" onClick={() => void importData()}>
            <Upload /> Import CSV
          </Button>
          <Button variant="secondary" onClick={() => void openProject()}>
            <FolderOpen /> Open project
          </Button>
        </div>

        <h2 className="mt-8 mb-2 text-2xs font-medium tracking-wide text-fg-muted uppercase">Load an example</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {examples.map((e) => (
            <li key={e.name}>
              <button
                type="button"
                onClick={() => void loadExample(e.name)}
                className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-3 focus-visible:-outline-offset-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{e.label}</span>
                  <span className="block text-xs text-fg-muted">{e.description}</span>
                </span>
                <ChevronRight className="size-4 text-fg-muted transition-transform duration-150 group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-6 flex items-center gap-1.5 text-xs text-fg-muted">
          <ShieldCheck className="size-4" aria-hidden /> Your data never leaves this browser.
        </p>
      </Card>
    </div>
  );
}

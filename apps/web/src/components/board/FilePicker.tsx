import { FilePlusIcon } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/** Real paths for picked or dropped files; only the desktop app can see them. */
function pathsOf(files: FileList | null): ReadonlyArray<string> {
  const pathFor = window.desktopBridge?.getPathForFile;
  if (files === null || pathFor === undefined) return [];
  return Array.from(files)
    .map((file) => pathFor(file))
    .filter((path) => path.length > 0);
}

/**
 * Adds files to a task by their path on this machine, so agents work on the originals instead
 * of uploaded copies. The desktop app picks or takes dropped files; a browser can only be told
 * a path, because it never sees where a file lives.
 */
export function FilePicker(props: {
  readonly disabled?: boolean;
  readonly onAdd: (paths: ReadonlyArray<string>) => void;
  /** Shown inside the drop area, such as the files already added. */
  readonly children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  const [dragging, setDragging] = useState(false);
  const canPick = window.desktopBridge?.getPathForFile !== undefined;

  const addTyped = () => {
    const path = typed.trim();
    if (path.length === 0) return;
    props.onAdd([path]);
    setTyped("");
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const paths = pathsOf(event.dataTransfer.files);
    if (paths.length > 0 && !props.disabled) props.onAdd(paths);
  };

  return (
    <div
      className={cn(
        // The padding, cancelled by the margin, gives the drop highlight room around the files.
        "-m-2 flex flex-col gap-2 rounded-xl p-2",
        dragging && "bg-primary/5 ring-2 ring-primary/40 ring-inset",
      )}
      onDragOver={(event) => {
        if (!canPick) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      {props.children}
      <div className="flex items-center gap-2">
        {canPick ? (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const paths = pathsOf(event.currentTarget.files);
                if (paths.length > 0) props.onAdd(paths);
                event.currentTarget.value = "";
              }}
            />
            <Button
              size="xs"
              variant="outline"
              disabled={props.disabled}
              onClick={() => inputRef.current?.click()}
            >
              <FilePlusIcon />
              Add files
            </Button>
            <span className="text-xs text-muted-foreground">
              or drop them here, or paste a path:
            </span>
          </>
        ) : null}
        <Input
          size="sm"
          value={typed}
          disabled={props.disabled}
          aria-label="File path"
          placeholder={canPick ? "Full path to a file" : "Paste the full path to a file"}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTyped();
            }
          }}
        />
        <Button
          size="xs"
          variant="ghost"
          disabled={props.disabled || typed.trim().length === 0}
          onClick={addTyped}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

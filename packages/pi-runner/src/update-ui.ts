import {
  bold,
  createCliRenderer,
  fg,
  type KeyEvent,
  RGBA,
  StyledText,
  TextAttributes,
  TextRenderable,
} from "@opentui/core";

export type UpdateDisplay = {
  progress: (label: string) => void;
  finish: (label: string) => Promise<void>;
  close: () => Promise<void>;
};

const spinners = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const themes = {
  dark: { foreground: "#e6edf3", muted: "#a5b3c5", accent: "#7dd3fc", brand: "#6ee7b7" },
  light: { foreground: "#1e293b", muted: "#526173", accent: "#0369a1", brand: "#047857" },
};

function ramp(from: string, to: string): RGBA[] {
  const channel = (offset: number, progress: number) => {
    const start = parseInt(from.slice(offset, offset + 2), 16);
    const end = parseInt(to.slice(offset, offset + 2), 16);

    return Math.round(start + (end - start) * progress);
  };

  return Array.from({ length: 24 }, (_, index) => {
    const progress = index / 23;

    return RGBA.fromInts(channel(1, progress), channel(3, progress), channel(5, progress), 255);
  });
}

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

function sheen(letters: string[], palette: RGBA[], progress: number): StyledText {
  const center = progress * (letters.length + 10) - 5;

  return new StyledText(
    letters.map((letter, index) => {
      const strength = Math.max(0, 1 - Math.abs(index - center) / 4);

      return bold(fg(palette[Math.round(strength * (palette.length - 1))])(letter));
    }),
  );
}

export async function createUpdateDisplay(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
  motion: boolean,
  onCancel: () => void,
): Promise<UpdateDisplay> {
  const renderer = await createCliRenderer({
    stdin: input,
    stdout: output,
    screenMode: "split-footer",
    footerHeight: 4,
    backgroundColor: RGBA.defaultBackground(),
    exitOnCtrlC: false,
    exitSignals: [],
    consoleMode: "disabled",
    openConsoleOnError: false,
    useMouse: false,
  });

  let closed = false;
  let closePromise: Promise<void> | undefined;
  let clock: ReturnType<typeof setInterval> | undefined;
  let phase: "working" | "success" = "working";
  let tick = 0;
  let introTick = 0;
  let cancelling = false;
  let labelText = "Checking for updates";
  let letters = graphemes(labelText);
  let theme = themes.dark;
  let brandColors = ramp(theme.brand, theme.accent);
  let shimmerColors = ramp(theme.foreground, theme.accent);
  let finishColors = ramp(theme.brand, theme.foreground);
  let finishPromise: Promise<void> | undefined;
  let finishResolve: (() => void) | undefined;

  function text(id: string, top: number, left: number, width?: number): TextRenderable {
    const node = new TextRenderable(renderer, {
      id,
      content: "",
      position: "absolute",
      top,
      left,
      fg: RGBA.defaultForeground(),
      bg: RGBA.defaultBackground(),
      height: 1,
      wrapMode: "none",
      truncate: true,
      selectable: false,
      right: width === undefined ? 0 : undefined,
      width,
    });

    try {
      renderer.root.add(node);
    } catch (error) {
      node.destroy();
      throw error;
    }

    return node;
  }

  function stopClock() {
    if (clock !== undefined) clearInterval(clock);
    clock = undefined;
    finishResolve?.();
    finishResolve = undefined;
  }

  function release() {
    if (closed) return;
    closed = true;
    stopClock();
    renderer.keyInput.off("keypress", onKeyPress);
    renderer.off("theme_mode", onThemeMode);
    renderer.off("destroy", release);
  }

  function close(): Promise<void> {
    closePromise ??= (async () => {
      release();

      try {
        renderer.destroy();
      } finally {
        await renderer.closed;
      }
    })();

    return closePromise;
  }

  function onKeyPress(key: KeyEvent) {
    if (closed || phase !== "working" || cancelling) return;

    if (key.name !== "escape" && !(key.ctrl && key.name === "c")) return;
    key.preventDefault();
    key.stopPropagation();
    cancelling = true;
    guidance.content = "Stopping the current command…";
    onCancel();
  }

  function onThemeMode(mode: string | null) {
    if (closed) return;
    theme = mode === "light" ? themes.light : themes.dark;
    brandColors = ramp(theme.brand, theme.accent);
    shimmerColors = ramp(theme.foreground, theme.accent);
    finishColors = ramp(theme.brand, theme.foreground);
    paint();
  }

  let title: TextRenderable;
  let glyph: TextRenderable;
  let label: TextRenderable;
  let detail: TextRenderable;
  let guidance: TextRenderable;

  function paint() {
    const word = graphemes("Kstack");
    title.content = new StyledText(
      word.map((letter, index) =>
        bold(
          fg(brandColors[Math.round((index / (word.length - 1)) * (brandColors.length - 1))])(
            letter,
          ),
        ),
      ),
    );
    const entrance = motion ? Math.min(introTick / 5, 1) : 1;
    title.opacity = 0.65 + 0.35 * (1 - (1 - entrance) ** 3);
    glyph.fg = phase === "success" ? theme.brand : theme.accent;
    glyph.content =
      phase === "success" ? "✓" : motion ? spinners[Math.floor(tick / 2) % spinners.length] : "●";
    label.fg = phase === "success" ? theme.brand : theme.foreground;
    label.content =
      motion && (phase === "working" || tick < 5)
        ? sheen(
            letters,
            phase === "working" ? shimmerColors : finishColors,
            phase === "working" ? (tick % 35) / 35 : tick / 4,
          )
        : labelText;
    detail.fg = theme.muted;
    guidance.fg = theme.muted;
  }

  function startClock() {
    if (!motion || clock !== undefined || closed) return;
    clock = setInterval(() => {
      tick++;
      introTick++;
      paint();

      if (phase === "success" && tick >= 5) stopClock();
    }, 40);
  }

  function progress(value: string) {
    if (closed || phase !== "working") return;
    // oxlint-disable-next-line no-control-regex -- Keep task labels inside their own terminal row.
    labelText = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
    letters = graphemes(labelText);
    paint();
    startClock();
  }

  function finish(value: string): Promise<void> {
    if (closed) return Promise.resolve();

    if (finishPromise) return finishPromise;
    progress(value);
    phase = "success";
    tick = 0;
    guidance.content = "";
    paint();

    if (!motion) return Promise.resolve();
    finishPromise = new Promise<void>((resolve) => {
      finishResolve = resolve;
    });
    startClock();

    return finishPromise;
  }

  try {
    renderer.once("destroy", release);
    title = text("update-title", 0, 0);
    glyph = text("update-glyph", 1, 0, 1);
    label = text("update-label", 1, 2);
    detail = text("update-detail", 2, 2);
    guidance = text("update-guidance", 3, 0);
    label.attributes = TextAttributes.BOLD;
    detail.content = "CLI · Pi skills · bundled skill links";
    guidance.content = "Esc / Ctrl+C: cancel";
    onThemeMode(renderer.themeMode);
    renderer.on("theme_mode", onThemeMode);
    renderer.keyInput.on("keypress", onKeyPress);
    progress(labelText);
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Update display setup and cleanup failed");
    }

    throw error;
  }

  return { progress, finish, close };
}

import { styleText } from "node:util";
import { wrapText } from "./terminal.js";

export function createProgress(
  write: (text: string) => void,
  options: { color?: boolean; width?: () => number } = {},
): (message: string | null) => void {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let timer: ReturnType<typeof setInterval> | undefined;
  let started = 0;
  let frame = 0;
  let message = "";
  const draw = () => {
    const elapsed = (Date.now() - started) / 1000;
    const spinner = frames[frame++ % frames.length];
    const label = `${message}  ${elapsed.toFixed(1)}s${elapsed >= 15 ? " · Still working…" : ""}`;
    const width = Math.max(4, (options.width?.() || 100) - 1);
    const text = wrapText(label, width - 2, "")[0];
    const icon = options.color ? styleText("magenta", spinner, { validateStream: false }) : spinner;
    write(`\r\x1b[K${icon} ${text}`);
  };
  return (next) => {
    if (next === null) {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
        write("\r\x1b[K");
      }
      return;
    }
    message = next;
    if (timer === undefined) {
      started = Date.now();
      frame = 0;
      timer = setInterval(draw, 80);
      timer.unref();
    }
    draw();
  };
}

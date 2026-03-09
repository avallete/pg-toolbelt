import * as clack from "@clack/prompts";
import type { CommandContext } from "@stricli/core";

function getStdout(context: CommandContext): NodeJS.WritableStream {
  return context.process.stdout as unknown as NodeJS.WritableStream;
}

function getStderr(context: CommandContext): NodeJS.WritableStream {
  return context.process.stderr as unknown as NodeJS.WritableStream;
}

function writeLine(stream: NodeJS.WritableStream, message: string): void {
  stream.write(message.endsWith("\n") ? message : `${message}\n`);
}

export function isInteractiveCli(context: CommandContext): boolean {
  const io = context.process as unknown as {
    stdin?: { isTTY?: boolean };
    stdout?: { isTTY?: boolean };
  };
  return Boolean(io.stdin?.isTTY && io.stdout?.isTTY && !clack.isCI());
}

export function logInfo(context: CommandContext, message: string): void {
  if (isInteractiveCli(context)) {
    clack.log.info(message);
    return;
  }
  writeLine(getStdout(context), message);
}

export function logSuccess(context: CommandContext, message: string): void {
  if (isInteractiveCli(context)) {
    clack.log.success(message);
    return;
  }
  writeLine(getStdout(context), message);
}

export function logWarning(context: CommandContext, message: string): void {
  if (isInteractiveCli(context)) {
    clack.log.warn(message);
    return;
  }
  writeLine(getStderr(context), message);
}

export function logError(context: CommandContext, message: string): void {
  if (isInteractiveCli(context)) {
    clack.log.error(message);
    return;
  }
  writeLine(getStderr(context), message);
}

export async function confirmAction(
  context: CommandContext,
  message: string,
): Promise<boolean> {
  if (!isInteractiveCli(context)) {
    return false;
  }

  const result = await clack.confirm({
    message,
    initialValue: false,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Operation cancelled.");
    return false;
  }
  return result;
}

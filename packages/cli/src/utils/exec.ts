import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  // false면 출력을 캡처해서 반환한다. 기본값은 터미널에 그대로 보여 준다.
  inherit?: boolean;
}

// 외부 명령을 실행하고 실패하면 종료 코드와 함께 예외를 던진다.
export function run(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  const inherit = options.inherit ?? true;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const detail = stderr.trim() ? `\n${stderr.trim()}` : '';
      reject(new Error(`명령이 실패했어요 (exit ${code}): ${command} ${args.join(' ')}${detail}`));
    });
  });
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    await run('/bin/sh', ['-c', `command -v ${command}`], { inherit: false });
    return true;
  } catch {
    return false;
  }
}

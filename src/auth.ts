import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type TokenSource = 'flag' | 'GITHUB_TOKEN' | 'GH_TOKEN' | 'gh' | 'none';

export interface ResolvedToken {
  token?: string;
  source: TokenSource;
}

/**
 * 依次尝试：命令行参数 → GITHUB_TOKEN → GH_TOKEN → `gh auth token`。
 * 找不到时不会报错，调用方按匿名请求处理。
 */
export async function resolveToken(explicit?: string): Promise<ResolvedToken> {
  if (explicit?.trim()) return { token: explicit.trim(), source: 'flag' };
  if (process.env.GITHUB_TOKEN?.trim()) {
    return { token: process.env.GITHUB_TOKEN.trim(), source: 'GITHUB_TOKEN' };
  }
  if (process.env.GH_TOKEN?.trim()) {
    return { token: process.env.GH_TOKEN.trim(), source: 'GH_TOKEN' };
  }
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
      timeout: 4000,
      windowsHide: true,
    });
    const token = stdout.trim();
    if (token) return { token, source: 'gh' };
  } catch {
    // 未安装 gh 或未登录，继续匿名
  }
  return { source: 'none' };
}

export function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

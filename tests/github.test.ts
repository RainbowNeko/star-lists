import { describe, expect, it } from 'vitest';
import {
  GitHubClient,
  RateLimitError,
  UserNotFoundError,
} from '../src/github.js';

const payload = (fullName: string, stars = 1) => ({
  id: 1,
  node_id: `R_${fullName}`,
  name: fullName.split('/')[1],
  full_name: fullName,
  owner: { login: fullName.split('/')[0] },
  html_url: `https://github.com/${fullName}`,
  description: 'demo',
  topics: ['cli'],
  language: 'Go',
  stargazers_count: stars,
  forks_count: 0,
  archived: false,
  fork: false,
  private: false,
  size: 10,
  homepage: '',
  default_branch: 'main',
  pushed_at: '2026-01-01T00:00:00Z',
  created_at: '2020-01-01T00:00:00Z',
  license: { spdx_id: 'MIT' },
});

describe('GitHubClient.listStarred', () => {
  it('处理分页、star 时间与 Link header', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('page=2')) {
        return new Response(JSON.stringify([{ starred_at: '2024-02-01T00:00:00Z', repo: payload('b/two') }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify([{ starred_at: '2024-01-01T00:00:00Z', repo: payload('a/one') }]),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            link: '<https://api.example/users/demo/starred?page=2>; rel="next"',
          },
        },
      );
    };
    const client = new GitHubClient({ fetchImpl, apiBase: 'https://api.example' });
    const result = await client.listStarred('demo');
    expect(result.repos.map((repo) => repo.nameWithOwner)).toEqual(['a/one', 'b/two']);
    expect(result.repos[0]?.starredAt).toBe('2024-01-01T00:00:00Z');
    expect(result.truncated).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('--limit 达到上限时标记 truncated', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify([{ repo: payload('a/one') }, { repo: payload('b/two') }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const client = new GitHubClient({ fetchImpl, apiBase: 'https://api.example' });
    const result = await client.listStarred('demo', { max: 1 });
    expect(result.repos).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it('404 → UserNotFoundError', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    const client = new GitHubClient({ fetchImpl, apiBase: 'https://api.example' });
    await expect(client.listStarred('nobody')).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('403 + 额度为 0 → RateLimitError', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1900000000',
          'content-type': 'application/json',
        },
      });
    const client = new GitHubClient({ fetchImpl, apiBase: 'https://api.example' });
    await expect(client.listStarred('demo')).rejects.toBeInstanceOf(RateLimitError);
  });
});

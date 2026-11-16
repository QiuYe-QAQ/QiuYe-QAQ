import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPOSITORY_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

export function parseConfig(input) {
  if (!input || typeof input.username !== 'string'
      || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(input.username)) {
    throw new Error('Invalid GitHub username in profile configuration.');
  }
  if (!Array.isArray(input.projects) || input.projects.length === 0) {
    throw new Error('At least one project is required.');
  }
  const seen = new Set();
  const projects = input.projects.map((project) => {
    if (!project || typeof project.repository !== 'string' || !REPOSITORY_NAME.test(project.repository)) {
      throw new Error('Invalid project repository in profile configuration.');
    }
    const identity = project.repository.toLowerCase();
    if (seen.has(identity)) throw new Error(`Duplicate project: ${project.repository}`);
    seen.add(identity);
    if (!Array.isArray(project.tags) || project.tags.length === 0) {
      throw new Error(`Tags are required for ${project.repository}.`);
    }
    return {
      repository: project.repository,
      summary: requireText(project.summary, 'Project summary'),
      tags: project.tags.map((tag) => requireText(tag, 'Project tag')),
    };
  });
  return { username: input.username, projects };
}

export function parseRepository(response, project) {
  if (response?.private !== false || typeof response.full_name !== 'string'
      || response.full_name.toLowerCase() !== project.repository.toLowerCase()) {
    throw new Error(`Expected public repository ${project.repository}.`);
  }
  const pushedAt = response.pushed_at;
  if (pushedAt !== null && (typeof pushedAt !== 'string' || Number.isNaN(Date.parse(pushedAt)))) {
    throw new Error(`Invalid repository update date for ${project.repository}.`);
  }
  return {
    ...project,
    name: response.full_name.split('/')[1],
    stars: requireCount(response.stargazers_count, 'Repository star count'),
    forks: requireCount(response.forks_count, 'Repository fork count'),
    updated: pushedAt === null ? null : new Date(pushedAt).toISOString().slice(0, 10),
  };
}

export function replaceProjects(readme, content) {
  const start = '<!-- PROJECTS:START -->';
  const end = '<!-- PROJECTS:END -->';
  const startIndex = readme.indexOf(start);
  const endIndex = readme.indexOf(end);
  if (startIndex < 0 || endIndex < startIndex
      || readme.indexOf(start, startIndex + start.length) >= 0
      || readme.indexOf(end, endIndex + end.length) >= 0) {
    throw new Error('Expected exactly one ordered PROJECTS marker pair in README.md.');
  }
  return `${readme.slice(0, startIndex + start.length)}\n${content.trim()}\n${readme.slice(endIndex)}`;
}

export function badgeUrl(label, message, color, logo) {
  // Shields uses doubled hyphens and underscores to escape badge text.
  const segment = (value) => encodeURIComponent(String(value).replaceAll('-', '--').replaceAll('_', '__'));
  const query = new URLSearchParams({ style: 'flat-square', ...(logo ? { logo, logoColor: 'white' } : {}) });
  return `https://img.shields.io/badge/${segment(label)}-${segment(message)}-${color}?${query}`;
}

function badge(label, message, color, logo) {
  return `<img src="${escapeHtml(badgeUrl(label, message, color, logo))}" alt="${escapeHtml(`${label}: ${message}`)}" />`;
}

/**
 * @param {Array<{repository: string, name: string, summary: string, tags: string[], stars: number, forks: number, updated: string | null}>} projects
 * @param {string} username
 */
export function renderProjects(projects, username) {
  const cells = projects.map((project) => `<td width="50%" valign="top">
<h3><a href="https://github.com/${escapeHtml(project.repository)}">${escapeHtml(project.name)}</a></h3>
<p>${escapeHtml(project.summary)}</p>
<p>${project.tags.map((tag) => `<code>${escapeHtml(tag)}</code>`).join(' &nbsp; ')}</p>
<p>
  ${badge('Stars', project.stars, '83b84c', 'github')}
  ${badge('Forks', project.forks, '5596c9', 'github')}
  ${badge('Updated', project.updated ?? 'No pushes yet', '4f9b85')}
</p>
</td>`);
  if (cells.length % 2 !== 0) {
    cells.push(`<td width="50%" valign="top">
<h3><a href="https://github.com/${escapeHtml(username)}?tab=repositories">More to explore ↗</a></h3>
<p>还有一些正在生长的想法，欢迎去仓库里看看。</p>
<p><code>Open source</code> &nbsp; <code>Keep building</code></p>
<p>${badge('Explore', 'All repositories', '7b68ae', 'github')}</p>
</td>`);
  }
  const rows = [];
  for (let index = 0; index < cells.length; index += 2) {
    rows.push(`<tr>\n${cells[index]}\n${cells[index + 1]}\n</tr>`);
  }
  return `<table>\n${rows.join('\n')}\n</table>`;
}

export async function requestRepository(repository, { token, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`https://api.github.com/repos/${repository}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'QiuYe-profile-updater',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub request for ${repository} failed (HTTP ${response.status}); README.md was not changed.`);
  }
  return response.json();
}

export async function updateProfile({ root = ROOT, token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN, fetchImpl = fetch } = {}) {
  const [rawConfig, originalReadme] = await Promise.all([
    readFile(join(root, 'scripts/profile/profile.config.json'), 'utf8'),
    readFile(join(root, 'README.md'), 'utf8'),
  ]);
  const config = parseConfig(JSON.parse(rawConfig));
  // Validate the edit boundary before making requests or writing any files.
  replaceProjects(originalReadme, '');
  const repositories = await Promise.all(config.projects.map((project) =>
    requestRepository(project.repository, { token, fetchImpl })));
  const projects = repositories.map((repository, index) => parseRepository(repository, config.projects[index]));
  const readme = replaceProjects(originalReadme, renderProjects(projects, config.username));
  if (readme === originalReadme) {
    console.log('Project data is unchanged.');
    return false;
  }
  // Every request and validation has succeeded; only the marked section is replaced.
  if (await readFile(join(root, 'README.md'), 'utf8') !== originalReadme) {
    throw new Error('README.md changed during the update; the newer edits were preserved.');
  }
  await writeFile(join(root, 'README.md'), readme, 'utf8');
  console.log(`Updated profile data for ${projects.length} public projects.`);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateProfile().catch((error) => {
    console.error(`Profile update failed: ${error.message}`);
    process.exitCode = 1;
  });
}

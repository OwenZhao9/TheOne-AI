import type { PiSkillCatalog, PiTaskNode, PiTaskResearchSource } from '@/common/pi';

async function githubJson<T>(url: URL, fetcher: typeof fetch, maxBytes = 1024 * 1024): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TheOne-task-research' },
    });
    if (!response.ok) throw new Error('task_research_network_failed');
    if (!response.body) throw new Error('task_research_network_failed');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error('task_research_response_too_large');
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('task_research_')) throw error;
    throw new Error('task_research_network_failed');
  } finally {
    clearTimeout(timer);
  }
}

/** Only fixed public GitHub endpoints are fetched. Results are reference data, never executable code. */
export async function researchTask(
  node: PiTaskNode,
  catalog: PiSkillCatalog,
  fetcher: typeof fetch = fetch
): Promise<{ queries: string[]; sources: PiTaskResearchSource[] }> {
  const subject = `${node.title} ${node.objective} ${node.research?.feedback || ''}`;
  const topic = /前端|frontend|front.end|界面|网页设计/i.test(subject)
    ? 'frontend website'
    : /后端|backend|back.end|服务端/i.test(subject)
      ? 'backend web api'
      : /logo|图片|作图|image|design/i.test(subject)
        ? 'image generation'
        : /网站|website|web app/i.test(subject)
          ? 'website'
          : subject
              .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
              .trim()
              .split(/\s+/)
              .slice(0, 5)
              .join(' ');
  const specificTerms = (
    subject.match(
      /\b(?:react|vue|svelte|nextjs|next.js|nuxt|nodejs|express|fastapi|django|flask|spring|typescript|tailwind|ecommerce|dashboard|portfolio|saas)\b/gi
    ) || []
  )
    .slice(0, 3)
    .join(' ');
  const terms = node.research?.searchTerms?.trim() || `${topic} ${specificTerms}`.trim();
  const queries = [`${terms} example`, `${terms} "SKILL.md" in:readme`];
  const sources: PiTaskResearchSource[] = [];
  for (const [index, query] of queries.entries()) {
    const url = new URL('https://api.github.com/search/repositories');
    url.searchParams.set('q', `${query} archived:false`);
    url.searchParams.set('per_page', '4');
    url.searchParams.set('sort', 'stars');
    const body = await githubJson<{
      items?: {
        full_name?: string;
        html_url?: string;
        default_branch?: string;
        description?: string;
        license?: { spdx_id?: string };
      }[];
    }>(url, fetcher);
    if (!Array.isArray(body.items)) throw new Error('task_research_network_failed');
    for (const item of body.items.slice(0, 4)) {
      if (typeof item.full_name !== 'string' || typeof item.html_url !== 'string') continue;
      const source = new URL(item.html_url);
      if (
        source.protocol !== 'https:' ||
        source.hostname !== 'github.com' ||
        !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(item.full_name)
      )
        continue;
      let sourceUrl = source.href;
      if (index === 1) {
        if (!item.default_branch) continue;
        const tree = await githubJson<{ tree?: { path?: string; type?: string }[]; truncated?: boolean }>(
          new URL(
            `https://api.github.com/repos/${item.full_name}/git/trees/${encodeURIComponent(item.default_branch)}?recursive=1`
          ),
          fetcher,
          8 * 1024 * 1024
        );
        const keywords = [
          ...terms.toLowerCase().split(/[^a-z0-9]+/),
          ...(topic.includes('frontend') ? ['frontend', 'design', 'react', 'ui', 'website'] : []),
          ...(topic.includes('backend') ? ['backend', 'api', 'server', 'architecture'] : []),
        ].filter((word) => word.length > 1);
        const score = (path: string): number => {
          const tokens = path.toLowerCase().split(/[^a-z0-9]+/);
          return keywords.filter((word) => tokens.includes(word)).length;
        };
        const skill = tree.tree
          ?.filter(
            (entry) =>
              entry.type === 'blob' && /(?:^|\/)SKILL\.md$/.test(entry.path || '') && score(entry.path || '') > 0
          )
          .toSorted((left, right) => score(right.path || '') - score(left.path || ''))[0];
        if (!skill?.path) continue;
        sourceUrl = `${source.href}/blob/${encodeURIComponent(item.default_branch)}/${skill.path.split('/').map(encodeURIComponent).join('/')}`;
      }
      sources.push({
        kind: index === 0 ? 'example' : 'skill',
        title: item.full_name.slice(0, 180),
        url: sourceUrl,
        description: typeof item.description === 'string' ? item.description.slice(0, 1000) : '',
        license: item.license?.spdx_id || 'NOASSERTION',
        available: false,
      });
    }
  }
  for (const skill of catalog.skills.filter((item) => node.candidateSkills.includes(item.name))) {
    if (skill.sourceUrl && !skill.sourceUrl.startsWith('https://')) continue;
    sources.push({
      kind: 'skill',
      title: skill.name,
      url: skill.sourceUrl || '',
      description: skill.description,
      license: skill.license,
      available: skill.approved && skill.installed && skill.trusted && skill.compatibility === 'compatible',
    });
  }
  return { queries, sources };
}

export function requiresResearchApproval(node?: PiTaskNode): boolean {
  return Boolean(node?.parentSessionId && node.research && node.research.state !== 'approved');
}

export function isWebsiteBuildRequest(text: string): boolean {
  if (/不要|别做|停止|如何|怎么|教程|举例|解释|\b(?:do not|don't|how to|tutorial|explain)\b/i.test(text)) return false;
  return /(?:做|开发|搭建|创建|制作).{0,20}(?:网站|web应用)|(?:build|create|develop).{0,30}(?:website|web app)/i.test(
    text
  );
}

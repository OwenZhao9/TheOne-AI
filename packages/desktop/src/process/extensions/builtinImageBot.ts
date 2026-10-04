import { validatePackage, type BotPackage } from './botPackage';
import { IMAGE_GENERATION_BOT_ID } from '@/common/pi/imageBot';

export const BUILTIN_IMAGE_BOT_SOURCE = 'builtin:theone.image-generation';

const manifest = {
  schemaVersion: 1 as const,
  id: IMAGE_GENERATION_BOT_ID,
  name: '作图助手',
  version: '1.0.0',
  description: '使用已配置的真实图像模型生成或编辑图片、Logo、插画、海报等视觉素材。',
  instructions:
    '你是 TheOne 的专门作图助手。遇到生成或编辑图片、Logo、插画、海报等请求时，必须先读取作图技能，并调用 TheOne 提供的 aionui_image_generation 工具。不要把提示词、占位图片、代码或文字描述冒充成图片交付。若图像模型或内置工具未配置，明确告诉用户需要在设置中配置，并保留原始请求；不要改用开发环境专属工具、系统语音或其他应用凭据。成功后说明实际图片文件路径，确保父任务可以检查、预览和复用该文件。',
  skills: ['skills/image-generation/SKILL.md'],
  requiredCapabilities: ['files'] as const,
  tags: ['作图', '设计', '图片'],
  starters: ['生成一个简洁的品牌 Logo', '画一张适合产品介绍页的插画', '把这张图片改成复古海报风格'],
  author: 'TheOne',
};

const skill = `---
name: image-generation
description: 用户需要生成或编辑图片、Logo、插画、海报等视觉素材时，使用 TheOne 的真实图像工具完成并交付实际文件。
---

# 作图

1. 先确认用户要创建还是编辑视觉素材；已给出足够信息时直接执行，不为明显不影响结果的细节反复提问。
2. 检查当前会话是否提供 \`aionui_image_generation\` 工具。它是 TheOne 内置的真实图像生成通道；不要调用开发会话专属能力，也不要编造图片。
3. 创建图片时，把用户意图整理成清楚的英文提示词，保留尺寸、主体、风格、颜色、文字内容和禁止项。编辑图片时，把所有输入图片路径放入 \`image_uris\`，不要遗漏任何一张。
4. 如果工具返回未配置、超时、取消或失败，原样说明需要的配置或下一步；保留用户输入，不以提示词、空文件、截图或占位图片当作完成。
5. 成功后确认返回的是实际图片文件，报告工作区中的实际路径，并用 Markdown 图片链接或现有预览能力让用户可以查看；不要把完整 base64 数据贴进回复。
6. 交付前检查文件存在、扩展名正确且不超出当前任务工作区；如果这是父任务的子任务，列出文件路径和验证证据，等待父任务验收后再视为完成。
`;

export function builtinImageBotPackage(): BotPackage {
  return validatePackage(
    new Map([
      ['bot.json', Buffer.from(JSON.stringify(manifest, null, 2))],
      ['skills/image-generation/SKILL.md', Buffer.from(skill)],
    ]),
    BUILTIN_IMAGE_BOT_SOURCE
  );
}

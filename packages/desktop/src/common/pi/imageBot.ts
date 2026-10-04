import type { PiAttachment } from './types';

export const IMAGE_GENERATION_BOT_ID = 'theone.image-generation';

const IMAGE_TARGET_PATTERN =
  /(image|picture|logo|icon|illustration|drawing|painting|poster|avatar|banner|visual|图片|图像|图画|标志|logo|图标|插画|插图|绘画|海报|头像|封面|视觉素材)/i;
const IMAGE_ACTION_PATTERN =
  /(generate|create|draw|paint|illustrate|render|make|design|edit|modify|redraw|生成|创建|绘制|画一|画个|绘画|制作|做一个|设计一个|设计一|编辑|修改|重绘|改成|替换)/i;
const IMAGE_EDIT_PATTERN = /(edit|modify|redraw|change|改成|修改|编辑|重绘|替换)/i;
const NON_GENERATION_PATTERN =
  /(how to|what is|explain|tutorial|compare|recommend|find|search|download|查看|分析|识别|描述|如何|怎么|怎样|教程|比较|推荐|查找|搜索|下载)/i;
const NON_VISUAL_IMPLEMENTATION_PATTERN =
  /(component|react|vue|html|css|frontend|website|implement|code|组件|网页|网站|前端|实现|代码|编程)/i;
const NON_VISUAL_CONTENT_PATTERN = /(readme|documentation|docs|说明|文档|文字|文本|上传)/i;

function isImageAttachment(attachment: PiAttachment): boolean {
  if (attachment.mimeType?.toLowerCase().startsWith('image/')) return true;
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)$/i.test(attachment.name);
}

/**
 * Detect only explicit visual-asset creation/editing requests.
 * Advice, analysis, search and ordinary file work stay in the current chat.
 */
export function isExplicitImageGenerationRequest(text: string, attachments: PiAttachment[] = []): boolean {
  const normalized = text.trim();
  if (!normalized || NON_GENERATION_PATTERN.test(normalized)) return false;
  const hasImageAttachment = attachments.some(isImageAttachment);
  const hasTarget = IMAGE_TARGET_PATTERN.test(normalized);
  if (
    hasTarget &&
    (NON_VISUAL_IMPLEMENTATION_PATTERN.test(normalized) || NON_VISUAL_CONTENT_PATTERN.test(normalized)) &&
    !hasImageAttachment
  )
    return false;
  return (
    (hasTarget && IMAGE_ACTION_PATTERN.test(normalized)) || (hasImageAttachment && IMAGE_EDIT_PATTERN.test(normalized))
  );
}

import { describe, expect, it } from 'vitest';
import { isExplicitImageGenerationRequest } from '@/common/pi/imageBot';

describe('isExplicitImageGenerationRequest', () => {
  it('recognizes direct image creation requests', () => {
    expect(isExplicitImageGenerationRequest('请生成一个产品 Logo')).toBe(true);
    expect(isExplicitImageGenerationRequest('Create a watercolor illustration of a fox')).toBe(true);
  });

  it('recognizes editing an attached image without requiring the prompt to repeat image', () => {
    expect(
      isExplicitImageGenerationRequest('把这张图改成复古海报风格', [{ name: 'reference.png', mimeType: 'image/png' }])
    ).toBe(true);
  });

  it('does not route analysis, search or ordinary non-image work', () => {
    expect(isExplicitImageGenerationRequest('分析这张图片的构图')).toBe(false);
    expect(isExplicitImageGenerationRequest('How do I generate a PNG in code?')).toBe(false);
    expect(isExplicitImageGenerationRequest('请修改 README 中关于图片上传的说明')).toBe(false);
  });

  it('does not route an unrelated attachment just because the prompt contains an edit verb', () => {
    expect(
      isExplicitImageGenerationRequest('修改这个文件中的标题', [{ name: 'notes.txt', mimeType: 'text/plain' }])
    ).toBe(false);
  });

  it('does not route a request to implement a visual component', () => {
    expect(isExplicitImageGenerationRequest('请设计一个 Logo React 组件')).toBe(false);
  });
});

/**
 * ScreenshotPreprocessor
 *
 * Prepares screenshot paths for Gemma 4 vision input via ExecuTorch.
 *
 * Gemma 4 uses pan-and-scan image encoding. The model expects a local file
 * path (not base64 or a remote URL). The ExecuTorch native module decodes
 * and resizes the image internally, so no pixel-level manipulation is needed
 * at the JS layer — only path normalization is required.
 *
 * Reference input resolution: 896x896 px (Gemma 4 pan-and-scan default).
 * The native module handles downscaling; passing larger images is safe but
 * increases preprocessing time (~50–100 ms on a Pixel 8).
 */

/** Metadata returned alongside a preprocessed screenshot path. */
export interface PreprocessedScreenshot {
  /** Normalized local file path, ready to pass as `imagePath` to the LLM. */
  path: string;
  /**
   * Whether the original input was a `file://` URI that was stripped.
   * Informational only.
   */
  wasNormalized: boolean;
}

export class ScreenshotPreprocessor {
  /**
   * Normalize a screenshot path for Gemma 4 vision input.
   *
   * Handles:
   * - `file:///data/...` → `/data/...`  (strips file:// prefix)
   * - Plain paths pass through unchanged
   *
   * @param rawPath - Path returned by `AccessibilityController.takeScreenshot()`
   * @returns Preprocessed screenshot metadata
   * @throws If the path is empty or appears to be a remote URL
   */
  static preprocess(rawPath: string): PreprocessedScreenshot {
    if (!rawPath || rawPath.trim().length === 0) {
      throw new Error('ScreenshotPreprocessor: rawPath must be a non-empty string');
    }

    if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
      throw new Error(
        'ScreenshotPreprocessor: remote URLs are not supported. ' +
          'The ExecuTorch native module requires a local file path.',
      );
    }

    const isFileUri = rawPath.startsWith('file://');
    const path = isFileUri ? rawPath.replace(/^file:\/\//, '') : rawPath;

    return { path, wasNormalized: isFileUri };
  }

  /**
   * Normalize a path and return just the string, for use as `imagePath`.
   *
   * @param rawPath - Raw path from `takeScreenshot()`
   * @returns Clean local file path
   */
  static normalizePath(rawPath: string): string {
    return ScreenshotPreprocessor.preprocess(rawPath).path;
  }

  /**
   * Build the text prefix injected into the prompt when an image is attached.
   *
   * This matches Gemma 4's expected multimodal turn format:
   * the image token appears before the text content in the user turn.
   *
   * @param prompt - The original text prompt
   * @returns Prompt prefixed with vision instruction
   */
  static buildVisionPrompt(prompt: string): string {
    return `[Image of current phone screen attached]\n\n${prompt}`;
  }
}

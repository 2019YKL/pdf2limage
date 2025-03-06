import { NextRequest, NextResponse } from 'next/server';
import path, { join } from 'path';
import { writeFile, mkdir, readFile, unlink } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';

// 常量定义
const DEFAULT_QUALITY = 80; // 默认质量设置降低到80
const MIN_QUALITY = 60; // 最低质量设置
const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024; // 4MB限制，确保在Vercel的负载限制内

// 日志函数
const logger = {
  info: (message: string, data?: unknown) => {
    console.log(`[INFO][STITCH] ${message}`, data ? JSON.stringify(data) : '');
  },
  error: (message: string, error: unknown) => {
    console.error(`[ERROR][STITCH] ${message}`, error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  }
};

// 获取系统临时目录的函数
function getTempDirectory() {
  // 始终使用系统临时目录，避免使用程序根目录下的public文件夹
  const tempDir = process.env.VERCEL ? '/tmp' : join(os.tmpdir(), 'pdf2limage');
  
  // 确保目录存在
  try {
    if (!existsSync(tempDir)) {
      // 使用同步方法创建目录，确保目录在后续操作前存在
      const fs = require('fs');
      fs.mkdirSync(tempDir, { recursive: true });
    }
  } catch (error) {
    console.error(`[ERROR] Failed to create temp directory: ${tempDir}`, error);
  }
  
  return tempDir;
}

// 获取输出目录函数
function getOutputDirectory() {
  // 同样使用系统临时目录下的output子目录
  const baseDir = getTempDirectory();
  const outputDir = join(baseDir, 'output');
  
  // 确保目录存在
  try {
    if (!existsSync(outputDir)) {
      const fs = require('fs');
      fs.mkdirSync(outputDir, { recursive: true });
    }
  } catch (error) {
    console.error(`[ERROR] Failed to create output directory: ${outputDir}`, error);
  }
  
  return outputDir;
}

// 构建公共URL路径
function getPublicPath(filename: string, sessionId: string) {
  // 在Vercel环境中，使用API端点来提供文件访问
  if (process.env.VERCEL) {
    const path = `${sessionId}/${filename}`;
    logger.info(`Using API route for file serving: /api/serve-image?path=${path}`);
    return `/api/serve-image?path=${path}`;
  } else {
    // 在开发环境中，直接构建相对URL
    const localPath = `/temp/${sessionId}/${filename}`;
    logger.info(`Using local file path: ${localPath}`);
    return localPath;
  }
}

// 改进清理临时文件的函数
async function cleanupTempFiles(filePaths: string[]) {
  // 在Vercel serverless环境中，我们不需要主动清理文件
  // 部署到Vercel时，每个请求都会在独立的环境中运行，请求结束后环境会被销毁
  if (process.env.VERCEL) {
    logger.info('Running on Vercel, skipping file cleanup');
    return;
  }
  
  for (const filePath of filePaths) {
    try {
      if (existsSync(filePath)) {
        await unlink(filePath);
        logger.info(`Cleaned up temporary file: ${filePath}`);
      }
    } catch (error) {
      logger.error('Error cleaning up temporary file', error);
    }
  }
}

export async function POST(request: NextRequest) {
  logger.info('Received image stitching request');
  logger.info(`Running in environment: ${process.env.VERCEL ? 'Vercel' : 'Development'}`);
  logger.info(`Temp directory will be: ${getTempDirectory()}`);
  logger.info(`Output directory will be: ${getOutputDirectory()}`);
  
  try {
    // 处理 multipart/form-data 请求
    const formData = await request.formData();
    
    // 获取会话ID（必需）
    const sessionId = formData.get('sessionId') as string;
    if (!sessionId) {
      logger.error('No session ID provided');
      return NextResponse.json({ error: 'No session ID provided' }, { status: 400 });
    }
    
    // 获取质量设置（可选，默认80）
    const quality = parseInt(formData.get('quality') as string || DEFAULT_QUALITY.toString(), 10);
    
    // 获取指定的页面范围（可选）
    const pageRange = formData.get('pageRange') as string;
    
    // 获取是否添加水印
    const addWatermark = formData.get('addWatermark') === 'true';
    
    logger.info(`Stitching images for session: ${sessionId}, quality: ${quality}, pageRange: ${pageRange || 'all'}, watermark: ${addWatermark}`);
    
    // 处理 multipart/form-data 请求
    const imageFiles = formData.getAll('images') as File[];
    
    if (!imageFiles || imageFiles.length === 0) {
      logger.error('No images provided', new Error("Missing images"));
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    logger.info(`Processing ${imageFiles.length} images for stitching`);

    // 获取系统临时目录
    const tempDir = getTempDirectory();
    const sessionTempDir = join(tempDir, sessionId);

    // 创建临时目录保存上传的图片
    if (!existsSync(sessionTempDir)) {
      logger.info(`Creating temp directory: ${sessionTempDir}`);
      await mkdir(sessionTempDir, { recursive: true });
    }

    // 保存上传的图片到临时目录
    const savedImagePaths: string[] = [];
    const tempFilesToCleanup: string[] = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const imagePath = join(sessionTempDir, file.name);
      
      await writeFile(imagePath, Buffer.from(await file.arrayBuffer()));
      savedImagePaths.push(imagePath);
      tempFilesToCleanup.push(imagePath);
      logger.info(`Saved image ${i + 1}/${imageFiles.length} to ${imagePath}`);
    }
    
    // 创建输出目录
    const outputDirPath = getOutputDirectory();
    if (!existsSync(outputDirPath)) {
      await mkdir(outputDirPath, { recursive: true });
    }
    
    // 输出文件路径
    const outputFilename = `stitched-${sessionId}.png`;
    const outputPath = join(outputDirPath, outputFilename);
    
    // Load all images with sharp and get their dimensions
    const imageDetails = await Promise.all(
      savedImagePaths.map(async (imagePath, index) => {
        try {
          const metadata = await sharp(imagePath).metadata();
          return {
            path: imagePath,
            width: metadata.width || 0,
            height: metadata.height || 0,
            name: path.basename(imagePath)
          };
        } catch (error) {
          logger.error(`Error processing image ${index}:`, error);
          throw new Error(`Failed to process image ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      })
    );

    // Sort image paths by filename (to maintain order)
    imageDetails.sort((a, b) => {
      const aName = a.name;
      const bName = b.name;
      
      // Make sure lastpic.png is always the last image
      if (aName === 'lastpic.png') return 1;
      if (bName === 'lastpic.png') return -1;
      
      // Otherwise sort by name
      return aName.localeCompare(bName);
    });

    // Find the maximum width
    const maxWidth = Math.max(...imageDetails.map(img => img.width));
    logger.info(`Maximum image width: ${maxWidth}px`);
    
    // Calculate total height needed
    const totalHeight = imageDetails.reduce((sum, img) => sum + img.height, 0);
    logger.info(`Total stitched image height will be: ${totalHeight}px`);

    // Create an array of image objects with positioning
    // 定义组合图像接口
    interface CompositeImage {
      input: string;
      top: number;
      left: number;
    }
    
    const compositeImages: CompositeImage[] = [];
    let currentY = 0;

    // 使用常规for循环代替for...of循环，避免迭代器兼容性问题
    for (let i = 0; i < imageDetails.length; i++) {
      const img = imageDetails[i];
      // Center images that are smaller than maxWidth
      const x = Math.floor((maxWidth - img.width) / 2);
      
      compositeImages.push({
        input: img.path,
        top: currentY,
        left: x
      });
      
      logger.info(`Positioned image ${i + 1} at x:${x}, y:${currentY}`);
      currentY += img.height;
    }

    // 压缩设置：使用更激进的压缩以减小文件大小
    async function createStitchedImage(quality = 80) {
      logger.info(`Attempting image stitching with quality: ${quality}`);
      
      try {
        const outputTempPath = `${outputPath}.temp.png`;
        logger.info(`Temporary stitched image will be saved to: ${outputTempPath}`);
        
        // 确保每个图像都存在
        for (const img of compositeImages) {
          if (!existsSync(img.input)) {
            logger.error(`Image file missing before stitching: ${img.input}`);
          }
        }
        
        // 记录所有图像的信息
        logger.info(`Stitching ${compositeImages.length} images with sharp`, { 
          width: maxWidth,
          height: totalHeight,
          images: compositeImages.map(img => ({
            path: img.input,
            top: img.top,
            left: img.left,
            exists: existsSync(img.input)
          }))
        });
        
        // 对于Vercel环境，我们使用更激进的压缩设置
        const compressionOptions = process.env.VERCEL 
          ? { 
              quality,
              compressionLevel: 9, // 最高压缩级别
              palette: true       // 使用调色板减少颜色数量
            }
          : { quality };
        
        await sharp({
          create: {
            width: maxWidth,
            height: totalHeight,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          }
        })
        .composite(compositeImages)
        .flatten({ background: { r: 255, g: 255, b: 255 } }) // 确保背景是纯白色
        .png(compressionOptions)
        .toFile(outputTempPath);
        
        logger.info(`Stitched image created successfully at: ${outputTempPath}`);
        
        // 检查文件大小
        const fileSize = statSync(outputTempPath).size;
        logger.info(`Generated image size with quality ${quality}: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
        
        if (fileSize <= MAX_FILE_SIZE_BYTES) {
          // 文件大小符合要求，重命名为最终文件
          await writeFile(outputPath, await readFile(outputTempPath));
          logger.info(`Final image saved to: ${outputPath}`);
          
          // 删除临时文件
          await unlink(outputTempPath);
          return { success: true, quality, fileSize };
        }
        
        return { success: false, quality, fileSize };
      } catch (error) {
        logger.error(`Error during image stitching with quality ${quality}:`, error);
        throw new Error(`Failed to stitch images: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // 二分查找法寻找最佳质量设置
    async function findOptimalQuality() {
      let low = MIN_QUALITY; // 最低质量
      let high = quality; // 从请求中获取的初始质量
      let bestQuality = low;
      let bestFileSize = 0;
      
      // 首先尝试使用最高质量
      const highQualityResult = await createStitchedImage(high);
      if (highQualityResult.success) {
        logger.info(`High quality (${high}) image is within size limit: ${(highQualityResult.fileSize / 1024 / 1024).toFixed(2)}MB`);
        return { quality: high, fileSize: highQualityResult.fileSize };
      }
      
      // 如果高质量不满足要求，使用二分法寻找最佳质量
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        
        if (mid === bestQuality) break; // 防止无限循环
        
        const result = await createStitchedImage(mid);
        
        if (result.success) {
          bestQuality = mid;
          bestFileSize = result.fileSize;
          // 尝试寻找更高的质量
          low = mid + 1;
        } else {
          // 尝试更低的质量
          high = mid - 1;
        }
      }
      
      // 如果找到了满足条件的质量
      if (bestQuality >= MIN_QUALITY) {
        // 确保使用找到的最佳质量生成最终图像
        if (bestQuality !== high) { // 如果最佳质量不是上次尝试的质量
          await createStitchedImage(bestQuality);
        }
        
        logger.info(`Found optimal quality: ${bestQuality} with file size: ${(bestFileSize / 1024 / 1024).toFixed(2)}MB`);
        return { quality: bestQuality, fileSize: bestFileSize };
      }
      
      // 如果都不满足条件，使用最低质量
      logger.info(`Using minimum quality (${MIN_QUALITY}) as no optimal quality found`);
      const minResult = await createStitchedImage(MIN_QUALITY);
      return { quality: MIN_QUALITY, fileSize: minResult.fileSize };
    }

    // 执行图像拼接和优化
    logger.info('Starting image stitching process');
    const compressionResult = await findOptimalQuality();
    const sizeMB = (compressionResult.fileSize / 1024 / 1024).toFixed(2);
    
    logger.info(`Image stitching completed successfully with quality ${compressionResult.quality} and size ${sizeMB}MB`);
    
    // 清理临时文件
    try {
      for (const imagePath of savedImagePaths) {
        await unlink(imagePath);
      }
      // 尝试删除临时目录
      await new Promise<void>((resolve) => {
        import('fs').then(fs => {
          fs.rmdir(sessionTempDir, (err: Error | null) => {
            if (err) {
              logger.info(`Note: Could not delete temp directory: ${err.message}`);
            }
            resolve();
          });
        });
      });
    } catch (cleanupError) {
      logger.error('Error during cleanup', cleanupError);
      // 继续执行，不因清理错误而中断响应
    }

    // 在Vercel环境中，暂时不清理文件
    if (process.env.VERCEL) {
      tempFilesToCleanup.length = 0;
    }

    // 返回stitched图像的URL和元数据
    return NextResponse.json({ 
      imageUrl: getPublicPath(outputFilename, sessionId),
      quality: compressionResult.quality,
      fileSize: sizeMB
    });

  } catch (error) {
    logger.error('Error processing request', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  } finally {
    // 处理完毕后清理所有临时文件
    if (tempFilesToCleanup.length > 0) {
      await cleanupTempFiles(tempFilesToCleanup);
    }
  }
}

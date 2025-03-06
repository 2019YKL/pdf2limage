import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import sharp from 'sharp';
import { randomUUID } from 'crypto';

// 常量定义
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB 的字节数
const MIN_QUALITY = 50; // 最低压缩质量

// 日志函数
const logger = {
  info: (message: string, data?: any) => {
    console.log(`[INFO][STITCH] ${message}`, data ? JSON.stringify(data) : '');
  },
  error: (message: string, error: any) => {
    console.error(`[ERROR][STITCH] ${message}`, error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  }
};

interface StitchRequest {
  images: string[];
}

export async function POST(request: NextRequest) {
  logger.info('Received image stitching request');
  
  try {
    logger.info('Parsing request body');
    const { images } = await request.json() as StitchRequest;
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      logger.error('Invalid images array provided', { images });
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    logger.info(`Processing ${images.length} images for stitching`, { imageUrls: images });

    // Create output directory if it doesn't exist
    const outputDir = join(process.cwd(), 'public', 'output');
    if (!existsSync(outputDir)) {
      logger.info(`Creating output directory: ${outputDir}`);
      await mkdir(outputDir, { recursive: true });
    }

    // Generate a unique ID for this stitched image
    const outputFileName = `stitched-${randomUUID()}.png`;
    const outputPath = join(outputDir, outputFileName);
    const publicPath = `/output/${outputFileName}`;
    
    logger.info(`Output will be saved to: ${outputPath}`);

    // Load all the images
    logger.info('Loading image metadata');
    const imageMetadataPromises = images.map(async (imagePath, index) => {
      try {
        const fullPath = join(process.cwd(), 'public', imagePath);
        logger.info(`Reading image ${index + 1}/${images.length}: ${fullPath}`);
        
        if (!existsSync(fullPath)) {
          logger.error(`Image file does not exist: ${fullPath}`);
          throw new Error(`Image file not found: ${imagePath}`);
        }
        
        const metadata = await sharp(fullPath).metadata();
        logger.info(`Image ${index + 1} metadata:`, { 
          width: metadata.width, 
          height: metadata.height,
          format: metadata.format
        });
        
        return { path: fullPath, width: metadata.width, height: metadata.height };
      } catch (error) {
        logger.error(`Error processing image ${index + 1}: ${imagePath}`, error);
        throw error;
      }
    });

    const imageMetadata = await Promise.all(imageMetadataPromises);
    logger.info('All image metadata loaded successfully');

    // Find the maximum width
    const maxWidth = Math.max(...imageMetadata.map(img => img.width || 0));
    logger.info(`Maximum image width: ${maxWidth}px`);
    
    // Calculate total height needed
    const totalHeight = imageMetadata.reduce((sum, img) => sum + (img.height || 0), 0);
    logger.info(`Total stitched image height will be: ${totalHeight}px`);

    // Create an array of image objects with positioning
    const compositeImages = [];
    let currentY = 0;

    for (const [index, img] of imageMetadata.entries()) {
      // Center images that are smaller than maxWidth
      const x = Math.floor((maxWidth - (img.width || 0)) / 2);
      
      compositeImages.push({
        input: img.path,
        top: currentY,
        left: x
      });
      
      logger.info(`Positioned image ${index + 1} at x:${x}, y:${currentY}`);
      currentY += img.height || 0;
    }

    // 渐进式图像压缩功能
    async function createStitchedImage(quality = 100) {
      logger.info(`Attempting image stitching with quality: ${quality}`);
      
      const outputTempPath = `${outputPath}.temp.png`;
      
      await sharp({
        create: {
          width: maxWidth,
          height: totalHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      })
      .composite(compositeImages)
      .png({ quality })
      .toFile(outputTempPath);
      
      // 检查文件大小
      const fileSize = statSync(outputTempPath).size;
      logger.info(`Generated image size with quality ${quality}: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
      
      if (fileSize <= MAX_FILE_SIZE_BYTES) {
        // 文件大小符合要求，重命名为最终文件
        await writeFile(outputPath, await readFile(outputTempPath));
        // 删除临时文件
        await new Promise<void>((resolve, reject) => {
          const fs = require('fs');
          fs.unlink(outputTempPath, (err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
        return { success: true, quality, fileSize };
      }
      
      return { success: false, quality, fileSize };
    }

    // 二分查找法寻找最佳质量设置
    async function findOptimalQuality() {
      let low = MIN_QUALITY; // 最低质量
      let high = 100; // 最高质量
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

    // 创建图像并进行大小检查
    logger.info('Starting image composition with automatic size optimization');
    try {
      const optimizationResult = await findOptimalQuality();
      
      logger.info(`Stitched image saved successfully to: ${outputPath} with quality: ${optimizationResult.quality}, size: ${(optimizationResult.fileSize / 1024 / 1024).toFixed(2)}MB`);

      return NextResponse.json({ 
        stitchedImage: publicPath,
        width: maxWidth,
        height: totalHeight,
        quality: optimizationResult.quality,
        sizeBytes: optimizationResult.fileSize,
        sizeMB: (optimizationResult.fileSize / 1024 / 1024).toFixed(2)
      });
    } catch (stitchError) {
      logger.error('Error during image composition', stitchError);
      return NextResponse.json(
        { error: 'Failed to compose stitched image', details: stitchError.message },
        { status: 500 }
      );
    }
  } catch (error) {
    logger.error('Image stitching error', error);
    return NextResponse.json(
      { 
        error: 'Failed to stitch images together', 
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

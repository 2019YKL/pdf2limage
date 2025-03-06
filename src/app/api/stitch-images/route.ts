import { NextRequest, NextResponse } from 'next/server';
import path, { join } from 'path';
import { writeFile, mkdir, readFile, unlink } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import fs from 'fs';

// 常量定义
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB 的字节数
const MIN_QUALITY = 50; // 最低压缩质量

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

export async function POST(request: NextRequest) {
  logger.info('Received image stitching request');
  
  try {
    // 处理 multipart/form-data 请求
    const formData = await request.formData();
    const imageFiles = formData.getAll('images') as File[];
    const tempDirName = formData.get('tempDirName') as string;
    const quality = parseInt(formData.get('quality') as string) || 90;
    
    if (!imageFiles || imageFiles.length === 0) {
      logger.error('No image files provided', {});
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    logger.info(`Processing ${imageFiles.length} images for stitching`);

    // 创建临时目录保存上传的图片
    const tempDir = join(process.cwd(), 'public', 'temp', tempDirName || randomUUID());
    if (!existsSync(tempDir)) {
      logger.info(`Creating temp directory: ${tempDir}`);
      await mkdir(tempDir, { recursive: true });
    }

    // 保存上传的图片到临时目录
    const savedImagePaths = await Promise.all(
      imageFiles.map(async (file, index) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        const filename = file.name;
        const imagePath = join(tempDir, filename);
        
        logger.info(`Saving image ${index + 1}/${imageFiles.length}: ${imagePath}`);
        await writeFile(imagePath, buffer);
        
        return imagePath;
      })
    );
    
    // Create output directory if it doesn't exist
    const outputDir = join(process.cwd(), 'public', 'output');
    if (!existsSync(outputDir)) {
      logger.info(`Creating output directory: ${outputDir}`);
      await mkdir(outputDir, { recursive: true });
    }

    // 清理旧的输出文件 (保留最近2小时内的文件)
    try {
      if (existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir);
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
        
        for (const file of files) {
          const filePath = path.join(outputDir, file);
          const stats = fs.statSync(filePath);
          
          if (stats.isFile() && stats.mtimeMs < twoHoursAgo) {
            logger.info(`Cleaning up old output file: ${filePath}`);
            fs.unlinkSync(filePath);
          }
        }
      }
    } catch (cleanupError) {
      logger.error('Error during old files cleanup', cleanupError);
      // 继续执行，不因清理错误而中断
    }

    // Generate a unique ID for this stitched image
    const outputFileName = `stitched-${randomUUID()}.png`;
    const outputPath = join(outputDir, outputFileName);
    const publicPath = `/output/${outputFileName}`;
    
    logger.info(`Output will be saved to: ${outputPath}`);

    // Load all the images
    logger.info('Loading image metadata');
    const imageMetadataPromises = savedImagePaths.map(async (imagePath, index) => {
      try {
        logger.info(`Reading image ${index + 1}/${savedImagePaths.length}: ${imagePath}`);
        
        if (!existsSync(imagePath)) {
          logger.error(`Image file does not exist: ${imagePath}`);
          throw new Error(`Image file not found: ${imagePath}`);
        }
        
        const metadata = await sharp(imagePath).metadata();
        logger.info(`Image ${index + 1} metadata:`, { 
          width: metadata.width, 
          height: metadata.height,
          format: metadata.format
        });
        
        return { path: imagePath, width: metadata.width, height: metadata.height };
      } catch (error) {
        logger.error(`Error processing image ${index + 1}: ${imagePath}`, error);
        throw error;
      }
    });

    const imageMetadata = await Promise.all(imageMetadataPromises);
    logger.info('All image metadata loaded successfully');

    // Sort image paths by filename (to maintain order)
    imageMetadata.sort((a, b) => {
      const aName = path.basename(a.path);
      const bName = path.basename(b.path);
      
      // Make sure lastpic.png is always the last image
      if (aName === 'lastpic.png') return 1;
      if (bName === 'lastpic.png') return -1;
      
      // Otherwise sort by name
      return aName.localeCompare(bName);
    });

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
    async function createStitchedImage(quality = 90) {
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
      .flatten({ background: { r: 255, g: 255, b: 255 } }) // 确保背景是纯白色
      .png({ quality })
      .toFile(outputTempPath);
      
      // 检查文件大小
      const fileSize = statSync(outputTempPath).size;
      logger.info(`Generated image size with quality ${quality}: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
      
      if (fileSize <= MAX_FILE_SIZE_BYTES) {
        // 文件大小符合要求，重命名为最终文件
        await writeFile(outputPath, await readFile(outputTempPath));
        // 删除临时文件
        await unlink(outputTempPath);
        return { success: true, quality, fileSize };
      }
      
      return { success: false, quality, fileSize };
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
          fs.rmdir(tempDir, (err: Error | null) => {
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

    // 返回stitched图像的URL和元数据
    return NextResponse.json({ 
      imageUrl: publicPath,
      quality: compressionResult.quality,
      fileSize: sizeMB
    });

  } catch (error) {
    logger.error('Error processing request', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

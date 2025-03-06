import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import sharp from 'sharp';
import { randomUUID } from 'crypto';

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

    // Create a new image with the composited images
    logger.info('Starting image composition');
    try {
      await sharp({
        create: {
          width: maxWidth,
          height: totalHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      })
      .composite(compositeImages)
      .png()
      .toFile(outputPath);
      
      logger.info(`Stitched image saved successfully to: ${outputPath}`);

      return NextResponse.json({ 
        stitchedImage: publicPath,
        width: maxWidth,
        height: totalHeight
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

import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { PDFDocument } from 'pdf-lib';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

// 日志函数
const logger = {
  info: (message: string, data?: unknown) => {
    console.log(`[INFO][PDF2PNG] ${message}`, data ? JSON.stringify(data) : '');
  },
  error: (message: string, error: unknown) => {
    console.error(`[ERROR][PDF2PNG] ${message}`, error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  }
};

// 删除临时文件的辅助函数
async function cleanupTempFiles(filePaths: string[]) {
  // 在Vercel serverless环境中，我们不需要主动清理文件
  // 部署到Vercel时，每个请求都会在独立的环境中运行，请求结束后环境会被销毁
  if (process.env.VERCEL) {
    logger.info('Running on Vercel, skipping file cleanup');
    return;
  }
  
  for (const filePath of filePaths) {
    try {
      await unlink(filePath);
      logger.info(`Cleaned up temporary file: ${filePath}`);
    } catch (error) {
      logger.error(`Failed to clean up temporary file: ${filePath}`, error);
    }
  }
}

// 获取系统临时目录的函数
function getTempDirectory() {
  // 始终使用系统临时目录，避免使用程序根目录下的public文件夹
  // 这样在Vercel环境中也能正常工作
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

export async function POST(request: NextRequest) {
  const sessionId = uuidv4();
  logger.info(`Starting PDF conversion process for session: ${sessionId}`);
  logger.info(`Running in environment: ${process.env.VERCEL ? 'Vercel' : 'Development'}`);
  logger.info(`Using system temp directory: ${getTempDirectory()}`);
  
  const tempFilesToCleanup: string[] = [];
  
  try {
    const formData = await request.formData();
    const pdfFile = formData.get('pdf') as File;
    
    if (!pdfFile) {
      logger.error('No PDF file provided', new Error("Missing PDF file"));
      return NextResponse.json({ 
        success: false, 
        error: 'No PDF file provided' 
      }, { status: 400 });
    }
    
    logger.info(`Processing PDF file: ${pdfFile.name}, size: ${pdfFile.size} bytes`);
    
    // 使用系统临时目录
    const baseDir = getTempDirectory();
    const tempDir = join(baseDir, sessionId);
    
    logger.info(`Using temp directory: ${tempDir}`);
    
    // 确保临时目录存在
    try {
      if (!existsSync(tempDir)) {
        logger.info(`Creating temp directory: ${tempDir}`);
        await mkdir(tempDir, { recursive: true });
      }
    } catch (dirError) {
      logger.error(`Failed to create temp directory: ${tempDir}`, dirError);
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to create temporary directory',
        details: dirError instanceof Error ? dirError.message : 'Unknown error' 
      }, { status: 500 });
    }
    
    // 保存 PDF 文件
    const pdfPath = join(tempDir, 'original.pdf');
    const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer());
    logger.info(`Saving PDF to: ${pdfPath}`);
    await writeFile(pdfPath, pdfBuffer);
    tempFilesToCleanup.push(pdfPath);
    
    // 获取 PDF 页数
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = pdfDoc.getPageCount();
    logger.info(`PDF loaded, page count: ${pageCount}`);
    
    // 在Vercel环境中，暂时不清理文件，让其他API能处理它们
    if (process.env.VERCEL) {
      tempFilesToCleanup.length = 0;
      
      // 在Vercel返回时，不要使用相对路径，因为public目录不可写
      // 提供绝对路径给后续API使用
      return NextResponse.json({
        success: true,
        sessionId,
        pageCount,
        pdfPath: tempDir, // 完整的临时目录路径
        tempDir // 确保传递临时目录供其他API使用
      });
    }
    
    return NextResponse.json({
      success: true,
      sessionId,
      pageCount,
      pdfPath: `/temp/${sessionId}/original.pdf`,
      tempDir // Include the actual temp directory path for other APIs
    });
    
  } catch (error) {
    logger.error('PDF conversion error', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to process PDF file', 
      details: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  } finally {
    // 在最后清理临时文件
    if (tempFilesToCleanup.length > 0) {
      await cleanupTempFiles(tempFilesToCleanup);
    }
  }
}

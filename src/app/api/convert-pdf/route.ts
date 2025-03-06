import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { PDFDocument } from 'pdf-lib';
import { v4 as uuidv4 } from 'uuid';

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

export async function POST(request: NextRequest) {
  const sessionId = uuidv4();
  logger.info(`Starting PDF conversion process for session: ${sessionId}`);
  
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
    
    // 创建临时目录存储 PDF 和图像
    const tempDir = join(process.cwd(), 'public', 'temp', sessionId);
    if (!existsSync(tempDir)) {
      logger.info(`Creating temp directory: ${tempDir}`);
      await mkdir(tempDir, { recursive: true });
    }
    
    // 保存 PDF 文件
    const pdfPath = join(tempDir, 'original.pdf');
    const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer());
    logger.info(`Saving PDF to: ${pdfPath}`);
    await writeFile(pdfPath, pdfBuffer);
    
    // 获取 PDF 页数
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = pdfDoc.getPageCount();
    logger.info(`PDF loaded, page count: ${pageCount}`);
    
    return NextResponse.json({
      success: true,
      sessionId,
      pageCount,
      pdfPath: `/temp/${sessionId}/original.pdf`
    });
  } catch (error) {
    logger.error('PDF conversion error', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to process PDF file', 
      details: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}

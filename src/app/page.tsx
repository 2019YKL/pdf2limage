"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import Image from "next/image";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDocument, setPdfDocument] = useState<any | null>(null);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [stitchedImage, setStitchedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pdfjs, setPdfjs] = useState<any | null>(null);

  useEffect(() => {
    const loadPdfJs = async () => {
      try {
        // 动态导入 PDF.js
        const pdfjs = await import('pdfjs-dist');
        
        // 设置 worker 为本地文件
        const workerSrc = '/pdf.worker.min.mjs';
        console.log('Setting PDF.js worker to:', workerSrc);
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        
        console.log('PDF.js loaded successfully');
        setPdfjs(pdfjs);
      } catch (error) {
        console.error('Failed to load PDF.js:', error);
        setError(`Failed to load PDF.js library: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
    
    loadPdfJs();
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
      setPageImages([]);
      setStitchedImage(null);
      setError(null);
      setPdfDocument(null);
      setPageCount(0);
      setCurrentPage(0);
      setProgress(0);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf']
    },
    maxFiles: 1
  });

  const loadPDF = useCallback(async (file: File) => {
    if (!pdfjs) {
      setError('PDF.js library is not loaded yet. Please try again in a moment.');
      return null;
    }
  
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      setPageCount(pdf.numPages);
      setPdfDocument(pdf);
      return pdf;
    } catch (error) {
      console.error('Error loading PDF:', error);
      setError(`PDF 加载失败: ${error instanceof Error ? error.message : '未知错误'}`);
      return null;
    }
  }, [pdfjs]);

  const renderPageToImage = useCallback(async (pdf: any, pageNumber: number) => {
    try {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2.0 });
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      if (!context) {
        throw new Error('无法获取 canvas 上下文');
      }
      
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      await page.render({
        canvasContext: context,
        viewport
      }).promise;
      
      const imageData = canvas.toDataURL('image/png');
      return imageData;
    } catch (error) {
      console.error(`Error rendering page ${pageNumber}:`, error);
      throw error;
    }
  }, []);

  const handleConversion = async () => {
    if (!file) return;
    if (!pdfjs) {
      setError('PDF.js library is not loaded yet. Please try again in a moment.');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setError(null);
    setPageImages([]);
    setStitchedImage(null);

    try {
      const formData = new FormData();
      formData.append('pdf', file);

      const response = await fetch('/api/convert-pdf', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('PDF upload failed:', errorData);
        throw new Error(
          errorData.details
            ? `PDF 上传失败: ${errorData.details}`
            : 'PDF 上传失败'
        );
      }

      const result = await response.json();
      setSessionId(result.sessionId);

      console.log(`开始客户端渲染 PDF，共 ${result.pageCount} 页`);
      const pdf = await loadPDF(file);

      if (!pdf) {
        throw new Error('无法加载 PDF 文件');
      }

      const renderedImages: string[] = [];
      const uploadPromises: Promise<string>[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        setCurrentPage(i);
        setProgress(Math.floor((i / pdf.numPages) * 50));

        try {
          const imageData = await renderPageToImage(pdf, i);
          renderedImages.push(imageData);

          const uploadPromise = uploadImage(imageData, result.sessionId, i - 1);
          uploadPromises.push(uploadPromise);
        } catch (pageError) {
          console.error(`页面 ${i} 渲染失败:`, pageError);
          throw new Error(`页面 ${i} 渲染失败: ${pageError instanceof Error ? pageError.message : '未知错误'}`);
        }
      }

      const uploadedImagePaths = await Promise.all(uploadPromises);
      setPageImages(uploadedImagePaths);
      setProgress(75);

      const stitchResponse = await fetch('/api/stitch-images', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ images: uploadedImagePaths })
      });

      if (!stitchResponse.ok) {
        const errorData = await stitchResponse.json();
        console.error('Image stitching failed:', errorData);
        throw new Error(
          errorData.details
            ? `图像拼接失败: ${errorData.details}`
            : '图像拼接失败'
        );
      }

      const stitchResult = await stitchResponse.json();
      setStitchedImage(stitchResult.stitchedImage);
      setProgress(100);
    } catch (err) {
      console.error('Error during conversion process:', err);
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setIsProcessing(false);
    }
  };

  const uploadImage = async (imageData: string, sessionId: string, pageIndex: number): Promise<string> => {
    try {
      const response = await fetch(imageData);
      const blob = await response.blob();

      const formData = new FormData();
      formData.append('image', blob, `page-${pageIndex}.png`);
      formData.append('sessionId', sessionId);
      formData.append('pageIndex', pageIndex.toString());

      const uploadResponse = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        throw new Error(errorData.details || '图像上传失败');
      }

      const result = await uploadResponse.json();
      return result.imagePath;
    } catch (error) {
      console.error(`Error uploading image for page ${pageIndex}:`, error);
      throw error;
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-800">PDF to Long Image Converter</h1>
          <p className="text-gray-600">Convert PDF files to PNG and stitch them into a single long image</p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 flex-grow">
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
            }`}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center justify-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-lg font-medium text-gray-700">
                {isDragActive ? "Drop your PDF here" : "Drag & drop your PDF here"}
              </p>
              <p className="text-sm text-gray-500">or click to select file</p>
            </div>
          </div>

          {file && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div>
                    <p className="font-medium text-gray-800">{file.name}</p>
                    <p className="text-sm text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                </div>
                <button
                  onClick={handleConversion}
                  disabled={isProcessing || !pdfjs}
                  className={`px-4 py-2 rounded-md font-medium ${
                    isProcessing || !pdfjs
                      ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isProcessing ? 'Processing...' : 'Convert & Stitch'}
                </button>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">
                  {currentPage > 0 ? `Processing page ${currentPage}/${pageCount}...` : 'Processing...'}
                </span>
                <span className="text-sm font-medium text-gray-700">{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-red-50 text-red-700 rounded-lg">
              <p className="font-medium">Error</p>
              <p className="whitespace-pre-wrap break-words">{error}</p>
              <div className="mt-3">
                <p className="text-sm text-red-600 font-medium">请检查控制台获取更多错误信息。</p>
                <p className="text-sm text-red-600">请确保您的系统已安装 Sharp 库及其依赖。</p>
              </div>
            </div>
          )}
        </div>

        {stitchedImage && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Result</h2>
            <div className="mb-4">
              <a
                href={stitchedImage}
                download="stitched-image.png"
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Stitched Image
              </a>
            </div>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <Image
                src={stitchedImage}
                alt="Stitched Image"
                width={800}
                height={1200}
                className="w-full h-auto"
                style={{ maxHeight: '600px', objectFit: 'contain' }}
              />
            </div>
          </div>
        )}
        
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </main>

      <footer className="bg-white border-t border-gray-200 py-6">
        <div className="container mx-auto px-4 text-center text-gray-600">
          <p>PDF to Long Image Converter - Built with Next.js & Tailwind CSS</p>
        </div>
      </footer>
    </div>
  );
}

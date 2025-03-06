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
  const [imageQuality, setImageQuality] = useState<number | null>(null);
  const [imageSize, setImageSize] = useState<string | null>(null);

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
    if (!file || isProcessing || !pdfjs) return;
    
    setIsProcessing(true);
    setError(null);
    setStitchedImage(null);
    setCurrentPage(0);
    setProgress(0);
    
    try {
      // Load the PDF file
      const fileData = await file.arrayBuffer();
      const pdfDoc = await pdfjs.getDocument({ data: fileData }).promise;
      const totalPages = pdfDoc.numPages;
      setPageCount(totalPages);
      
      // Check if PDF exceeds page limit
      const pageLimit = 30;
      const hasExceededLimit = totalPages > pageLimit;
      const pagesToProcess = hasExceededLimit ? pageLimit : totalPages;
      
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("Canvas element not found");
      
      // Create a temporary directory to store the extracted images
      const timestamp = Date.now();
      const tempDirName = `pdf-extract-${timestamp}`;
      const formData = new FormData();
      formData.append('tempDirName', tempDirName);
      
      // Loop through each page and convert to an image
      for (let i = 1; i <= pagesToProcess; i++) {
        setCurrentPage(i);
        
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        const context = canvas.getContext('2d');
        if (!context) throw new Error("Could not get canvas context");
        
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;
        
        const imageData = canvas.toDataURL('image/png');
        const blob = await (await fetch(imageData)).blob();
        
        formData.append('images', blob, `page-${i.toString().padStart(3, '0')}.png`);
        setProgress(Math.floor((i / pagesToProcess) * 50)); // First 50% of progress
      }
      
      // If exceeded limit, add the lastpic.png 
      if (hasExceededLimit) {
        try {
          const lastpicResponse = await fetch('/pic/lastpic.png');
          if (lastpicResponse.ok) {
            const lastpicBlob = await lastpicResponse.blob();
            formData.append('images', lastpicBlob, `page-${(pagesToProcess + 1).toString().padStart(3, '0')}.png`);
          } else {
            console.warn('Could not fetch lastpic.png');
          }
        } catch (error) {
          console.error('Error adding lastpic.png:', error);
        }
      }
      
      // Stitch the images together
      setProgress(55); // Start of stitching process
      
      formData.append('quality', '90'); // Default quality
      
      const response = await fetch('/api/stitch-images', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to stitch images: ${errorText}`);
      }
      
      const result = await response.json();
      setStitchedImage(result.imageUrl);
      setImageSize(result.fileSize);
      setImageQuality(result.quality);
      setProgress(100);
    } catch (error) {
      console.error('Conversion error:', error);
      setError(error instanceof Error ? error.message : String(error));
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
    <div className="flex flex-col min-h-screen bg-[#0BA4F9]">
      {/* 背景图案 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-white opacity-10 rounded-full blur-2xl"></div>
        <div className="absolute bottom-36 -left-20 w-72 h-72 bg-white opacity-10 rounded-full blur-xl"></div>
        <div className="absolute top-1/3 left-1/3 w-48 h-48 bg-white opacity-20 rounded-full blur-md"></div>
      </div>

      <main className="container mx-auto px-4 py-12 flex-grow relative z-10">
        <div className="max-w-3xl mx-auto">
          {/* 标题 */}
          <h1 className="text-4xl font-bold text-center text-white mb-8">PDF to Long Image</h1>
          
          {/* 主内容区 */}
          <div className="backdrop-blur-xl bg-white/20 rounded-xl shadow-xl p-8 mb-8 border border-white/30">
            {/* 上传区域 */}
            <div 
              {...getRootProps()} 
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${
                isDragActive 
                  ? 'border-white bg-white/20' 
                  : 'border-white/40 hover:border-white hover:bg-white/10'
              }`}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center justify-center gap-4">
                <div className="p-4 rounded-full bg-white/20 backdrop-blur-md">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-white">
                  {isDragActive ? "Drop your PDF here" : "Drag & drop your PDF"}
                </p>
                <button className="mt-2 px-6 py-2 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/30 transition-all border border-white/30">
                  Choose File
                </button>
              </div>
            </div>

            {file && (
              <div className="mt-6 p-5 bg-white/20 backdrop-blur-xl rounded-lg border border-white/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-white/20 rounded-full backdrop-blur-md">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium text-white">{file.name}</p>
                      <p className="text-sm text-white/80">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                  <button
                    onClick={handleConversion}
                    disabled={isProcessing || !pdfjs}
                    className={`px-6 py-3 rounded-full font-medium ${
                      isProcessing || !pdfjs
                        ? 'bg-gray-600/50 text-gray-400 cursor-not-allowed'
                        : 'bg-white/20 backdrop-blur-md text-white hover:bg-white/30 transition-all border border-white/30'
                    }`}
                  >
                    {isProcessing ? 'Processing...' : 'Convert'}
                  </button>
                </div>
              </div>
            )}
            
            {isProcessing && (
              <div className="mt-6 p-4 bg-white/20 backdrop-blur-xl rounded-lg border border-white/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">
                    {currentPage > 0 ? `Processing page ${currentPage}/${pageCount > 30 ? '30+' : pageCount}` : 'Processing...'}
                  </span>
                  <span className="text-sm font-medium text-white">{progress}%</span>
                </div>
                <div className="w-full bg-white/20 rounded-full h-2.5">
                  <div className="bg-[#0084c7] h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-6 p-4 bg-red-50/30 backdrop-blur-xl text-red-100 rounded-lg border border-red-200/30">
                <p className="font-medium">Error</p>
                <p className="whitespace-pre-wrap break-words">{error}</p>
              </div>
            )}
          </div>

          {stitchedImage && (
            <div className="backdrop-blur-xl bg-white/20 rounded-xl shadow-xl p-8 mb-8 border border-white/30">
              <div className="flex items-center mb-6">
                <div className="p-3 bg-white/20 backdrop-blur-md rounded-full mr-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold text-white">Complete</h2>
              </div>
              
              <div className="bg-white/20 backdrop-blur-xl p-4 rounded-lg mb-6 flex flex-wrap items-center gap-4">
                <a
                  href={stitchedImage}
                  download="stitched-image.png"
                  className="inline-flex items-center px-6 py-3 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/30 transition-all border border-white/30"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Image
                </a>
                
                <div className="flex flex-wrap gap-3">
                  {imageSize && (
                    <span className="px-3 py-1 bg-white/20 backdrop-blur-md text-white rounded-full text-sm flex items-center border border-white/30">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {imageSize} MB
                    </span>
                  )}
                  
                  {imageQuality !== null && imageQuality < 100 && (
                    <span className="px-3 py-1 bg-white/20 backdrop-blur-md text-white rounded-full text-sm flex items-center border border-white/30">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {imageQuality}% quality
                    </span>
                  )}
                </div>
              </div>
              
              <div className="rounded-xl border border-white/30 overflow-hidden bg-white/20 backdrop-blur-xl p-2">
                <Image 
                  src={stitchedImage} 
                  alt="Stitched Image" 
                  width={800} 
                  height={1200} 
                  className="w-full h-auto rounded-lg"
                  style={{ maxHeight: '600px', objectFit: 'contain' }}
                />
              </div>
            </div>
          )}
          
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
      </main>

      <footer className="relative z-10 py-6 text-center text-white/70">
        <p className="text-sm"> {new Date().getFullYear()} PDF to Long Image Converter</p>
      </footer>
    </div>
  );
}

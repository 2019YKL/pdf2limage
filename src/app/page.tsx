"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import Image from "next/image";
import * as pdfjs from 'pdfjs-dist';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [stitchedImage, setStitchedImage] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [imageQuality, setImageQuality] = useState<number | null>(null);
  const [imageSize, setImageSize] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const loadPdfjs = async () => {
      try {
        // 设置 worker 为本地文件
        const workerSrc = '/pdf.worker.min.mjs';
        console.log('Setting PDF.js worker to:', workerSrc);
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        
        console.log('PDF.js loaded successfully');
      } catch (err) {
        console.error('Error initializing PDF.js:', err);
      }
    };
    
    loadPdfjs();
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file?.type !== 'application/pdf') {
      setError('Please upload a PDF file');
      return;
    }

    setFile(file);
    setError(null);
    setStitchedImage(null);
    setProgress(0);
    setCurrentPage(0);
    setPageCount(0);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf']
    }
  });

  const handleConversion = async () => {
    if (!file || !canvasRef.current) return;
    
    try {
      setIsProcessing(true);
      setError(null);
      setProgress(0);
      setStitchedImage(null);
      
      // Load the PDF file
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      
      // Get total page count and set max to 30
      const totalPages = pdf.numPages;
      setPageCount(totalPages);
      
      // We'll convert all pages, but limit to 30 for processing
      const pagesToProcess = Math.min(totalPages, 30);
      
      // Generate images for each page
      const imageDataArray: Blob[] = [];
      
      for (let i = 1; i <= pagesToProcess; i++) {
        setCurrentPage(i);
        
        // Render PDF page to canvas
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        await page.render({
          canvasContext: context!,
          viewport: viewport
        }).promise;
        
        // Convert canvas to blob
        const blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((blob) => {
            resolve(blob!);
          }, 'image/png');
        });
        
        imageDataArray.push(blob);
        
        // Update progress
        setProgress(Math.round((i / pagesToProcess) * 90)); // Save 10% for stitching
      }
      
      // 创建一个表单数据对象
      const formData = new FormData();
      
      // 添加所有图像数据
      imageDataArray.forEach((blob, index) => {
        formData.append('images', new File([blob], `page-${index + 1}.png`, { type: 'image/png' }));
      });
      
      // 获取lastpic.png并添加到图像数组的末尾 - 无论页数多少都添加
      try {
        let lastPicPath = '/pic/lastpic.png'; // 原始路径
        let response = await fetch(lastPicPath);
        
        // 如果原始路径失败，尝试备用路径
        if (!response.ok) {
          lastPicPath = '/lastpic.png';
          response = await fetch(lastPicPath);
        }
        
        if (response.ok) {
          const lastPicBlob = await response.blob();
          formData.append('images', new File([lastPicBlob], 'lastpic.png', { type: 'image/png' }));
          console.log('成功添加lastpic.png到图像队列');
        } else {
          console.error('Failed to fetch lastpic.png, tried paths:', '/pic/lastpic.png', '/lastpic.png');
        }
      } catch (error) {
        console.error('Error fetching lastpic.png:', error);
      }
      
      // Set quality and add temp directory name
      formData.append('quality', '90');
      formData.append('tempDirName', `pdf-${Date.now()}`);
      
      // Send to API for stitching
      setProgress(95); // Almost done
      
      const stitchResponse = await fetch('/api/stitch-images', {
        method: 'POST',
        body: formData
      });
      
      if (!stitchResponse.ok) {
        const errorData = await stitchResponse.json();
        throw new Error(`Stitching failed: ${errorData.error || 'Unknown error'}`);
      }
      
      const result = await stitchResponse.json();
      
      setStitchedImage(result.imageUrl);
      setProgress(100);
      setImageQuality(result.quality);
      setImageSize(result.fileSize);
      
    } catch (error) {
      console.error('Conversion error:', error);
      setError(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#EBF6FF]">
      <main className="container mx-auto px-4 py-8 flex-grow">
        <div className="max-w-3xl mx-auto">
          {/* 标题 */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-800 mb-2">PDF to Long Image</h1>
            <p className="text-gray-600">Convert your PDF documents into a single long image</p>
          </div>
          
          {/* 主内容区 */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            {/* 上传区域 */}
            <div 
              {...getRootProps()} 
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${
                isDragActive 
                  ? 'border-blue-500 bg-blue-50' 
                  : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
              }`}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center justify-center gap-4">
                <div className="p-4 rounded-full bg-blue-100">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-gray-700">
                  {isDragActive ? "Drop your PDF here" : "Drag & drop your PDF"}
                </p>
                <button className="mt-2 px-6 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-all">
                  Choose File
                </button>
              </div>
            </div>

            {file && (
              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-blue-100 rounded-full">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">{file.name}</p>
                      <p className="text-sm text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                  <button
                    onClick={handleConversion}
                    disabled={isProcessing}
                    className={`px-6 py-2 rounded-full font-medium ${
                      isProcessing
                        ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                        : 'bg-blue-500 text-white hover:bg-blue-600 transition-all'
                    }`}
                  >
                    {isProcessing ? 'Processing...' : 'Convert'}
                  </button>
                </div>
              </div>
            )}
            
            {isProcessing && (
              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    {currentPage > 0 ? `Processing page ${currentPage}/${pageCount > 30 ? '30+' : pageCount}` : 'Processing...'}
                  </span>
                  <span className="text-sm font-medium text-gray-700">{progress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div className="bg-blue-500 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-6 p-4 bg-red-50 text-red-700 rounded-lg">
                <p className="font-medium">Error</p>
                <p className="whitespace-pre-wrap break-words">{error}</p>
              </div>
            )}
          </div>

          {stitchedImage && (
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <div className="flex items-center mb-6">
                <div className="p-3 bg-green-100 rounded-full mr-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold text-gray-800">Complete</h2>
              </div>
              
              <div className="bg-blue-50 p-4 rounded-lg mb-6 flex flex-wrap items-center gap-4">
                <a
                  href={stitchedImage}
                  download="stitched-image.png"
                  className="inline-flex items-center px-6 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Image
                </a>
                
                <div className="flex flex-wrap gap-3">
                  {imageSize && (
                    <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {imageSize} MB
                    </span>
                  )}
                  
                  {imageQuality !== null && imageQuality < 100 && (
                    <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {imageQuality}% quality
                    </span>
                  )}
                </div>
              </div>
              
              <div className="rounded-lg border border-gray-200 overflow-hidden p-2">
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

      <footer className="py-4 text-center text-gray-500">
        <p className="text-sm"> {new Date().getFullYear()} PDF to Long Image Converter</p>
      </footer>
    </div>
  );
}

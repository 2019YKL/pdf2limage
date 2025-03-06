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
      
      // Step 1: 上传PDF文件到API进行处理
      const pdfFormData = new FormData();
      pdfFormData.append('pdf', file);
      
      console.log('Uploading PDF to server...');
      const pdfResponse = await fetch('/api/convert-pdf', {
        method: 'POST',
        body: pdfFormData
      });
      
      if (!pdfResponse.ok) {
        let errorMsg = 'Failed to upload PDF';
        try {
          const errorData = await pdfResponse.json();
          errorMsg = errorData.error || errorMsg;
          if (errorData.details) {
            console.error('Error details:', errorData.details);
          }
          if (errorData.stack) {
            console.error('Error stack:', errorData.stack);
          }
        } catch (e) {
          console.error('Error parsing error response:', e);
        }
        throw new Error(errorMsg);
      }
      
      let pdfResult;
      try {
        pdfResult = await pdfResponse.json();
        console.log('PDF upload result:', pdfResult);
      } catch (e) {
        console.error('Error parsing PDF API response:', e);
        throw new Error('Invalid response from server when uploading PDF');
      }
      
      const { sessionId, tempDir, pageCount: totalPages } = pdfResult;
      setPageCount(totalPages);
      
      // Load the PDF file on client side for rendering
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      
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
        let lastPicPath = '/lastpic.png'; // 简化路径
        const response = await fetch(lastPicPath);
        
        if (response.ok) {
          const lastPicBlob = await response.blob();
          formData.append('images', new File([lastPicBlob], 'lastpic.png', { type: 'image/png' }));
          console.log('成功添加lastpic.png到图像队列');
        } else {
          console.error('Failed to fetch lastpic.png from:', lastPicPath);
        }
      } catch (error) {
        console.error('Error fetching lastpic.png:', error);
      }
      
      // 设置质量和会话ID
      formData.append('quality', '80'); // 降低默认质量为80
      formData.append('sessionId', sessionId); // 修改参数名称
      formData.append('addWatermark', 'true'); // 添加水印参数
      
      // Send to API for stitching
      setProgress(95); // Almost done
      console.log('Sending images to stitch API...');
      
      let stitchResponse;
      try {
        stitchResponse = await fetch('/api/stitch-images', {
          method: 'POST',
          body: formData
        });
      } catch (e) {
        console.error('Network error during stitch request:', e);
        throw new Error('Network error when stitching images');
      }
      
      if (!stitchResponse.ok) {
        let errorMsg = 'Stitching failed';
        try {
          const errorData = await stitchResponse.text();
          console.error('Stitch error response:', errorData);
          try {
            const jsonError = JSON.parse(errorData);
            errorMsg = jsonError.error || errorMsg;
          } catch {
            errorMsg += `: ${errorData.substring(0, 100)}`;
          }
        } catch (e) {
          console.error('Error parsing stitch error:', e);
        }
        throw new Error(errorMsg);
      }
      
      let result;
      try {
        const responseText = await stitchResponse.text();
        console.log('Raw stitch response:', responseText.substring(0, 200));
        result = JSON.parse(responseText);
      } catch (e) {
        console.error('Error parsing stitch response:', e);
        throw new Error('Invalid response from server when stitching images');
      }
      
      console.log('Stitch complete, result:', result);
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
            <div className="flex items-center justify-center mb-3">
              <svg className="w-10 h-10 text-blue-500 mr-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <h1 className="text-4xl font-bold text-gray-800">PDF to Long Image</h1>
            </div>
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

      <footer className="py-6 text-center text-gray-500 bg-white border-t border-gray-200">
        <div className="container mx-auto">
          <p className="text-sm mb-2"> {new Date().getFullYear()} PDF to Long Image Converter</p>
          <p className="text-xs text-gray-400 flex items-center justify-center">
            <span>Built with</span>
            <svg className="w-4 h-4 mx-1 text-blue-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
              <path d="M2 17l10 5 10-5"></path>
              <path d="M2 12l10 5 10-5"></path>
            </svg>
            <span>Next.js</span>
            <span className="mx-1">•</span>
            <svg className="w-4 h-4 mx-1 text-purple-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
            </svg>
            <span>Sharp</span>
            <span className="mx-1">•</span> 
            <span>由qizhi发明</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

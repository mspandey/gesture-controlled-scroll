@echo off
echo ================================================
echo GestureScroll — Build + Verification Script
echo ================================================
echo.
echo Step 1: Navigating to project directory...
cd /d "C:\Users\Amisha\OneDrive\Desktop\projects\autoscroll"

echo Step 2: Running build...
npm run build

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Build failed with exit code %ERRORLEVEL%
  echo Check the error messages above.
  pause
  exit /b 1
)

echo.
echo ================================================
echo Build completed! Verifying dist/ contents...
echo ================================================
echo.

echo --- dist/ root ---
dir dist\ /b

echo.
echo --- dist/content-scripts/ ---
dir dist\content-scripts\ /b

echo.
echo --- dist/background/ ---
dir dist\background\ /b

echo.
echo --- dist/popup/ ---
dir dist\popup\ /b

echo.
echo --- dist/options/ ---
dir dist\options\ /b

echo.
echo --- dist/assets/mediapipe/ ---
dir dist\assets\mediapipe\ /b

echo.
echo --- Verifying content-main.js is IIFE (not ESM) ---
findstr /c:"(function()" dist\content-scripts\content-main.js >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo [OK] content-main.js uses IIFE format
) else (
  echo [WARNING] IIFE wrapper not detected - checking alternate format...
  findstr /c:"var __getOwnPropNames" dist\content-scripts\content-main.js >nul 2>&1
  if %ERRORLEVEL% EQU 0 (
    echo [OK] content-main.js uses IIFE format ^(esbuild IIFE variant^)
  ) else (
    echo [ERROR] content-main.js may not be in IIFE format!
    echo First line of file:
    for /f "delims=" %%i in (dist\content-scripts\content-main.js) do (
      echo %%i
      goto :donecheck
    )
    :donecheck
  )
)

echo.
echo --- Verifying STEP 1 log exists in bundle ---
findstr /c:"CONTENT SCRIPT INJECTED" dist\content-scripts\content-main.js >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo [OK] STEP 1 injection log found in bundle
) else (
  echo [ERROR] STEP 1 injection log NOT found in bundle!
)

echo.
echo ================================================
echo NEXT STEPS:
echo ================================================
echo 1. Open Chrome and go to: chrome://extensions
echo 2. Enable Developer Mode ^(top-right toggle^)
echo 3. Click "Load unpacked"
echo 4. Select: C:\Users\Amisha\OneDrive\Desktop\projects\autoscroll\dist\
echo    ^(NOT the project root! NOT src/! The DIST folder!^)
echo 5. Open a new tab to any page ^(e.g. https://www.example.com^)
echo 6. Open DevTools ^(F12^) → Console tab
echo 7. Look for: [GestureScroll] STEP 1 CONTENT SCRIPT INJECTED
echo.
echo If you see the STEP 1 log: Phase 2 PASSED!
echo If you don't see it: Check chrome://extensions for red Errors button.
echo.
pause

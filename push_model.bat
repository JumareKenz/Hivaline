@echo off
REM Push LFM2.5 Q4_K_M model to device

set ADB=C:\Users\INEWTON\AppData\Local\Android\Sdk\platform-tools\adb.exe
set MODEL=C:\Users\INEWTON\Downloads\hiva_Q4_K_M.gguf

echo Pushing model to device temp location...
%ADB% push "%MODEL%" /data/local/tmp/lfm25.gguf

echo.
echo Copying to app storage...
%ADB% shell "run-as com.hiva.runtime sh -c 'cat /data/local/tmp/lfm25.gguf > files/models/lfm25/model.gguf'"

echo.
echo Verifying...
%ADB% shell "run-as com.hiva.runtime ls -lh files/models/lfm25/model.gguf"

echo.
echo Cleaning up temp file...
%ADB% shell "rm /data/local/tmp/lfm25.gguf"

echo.
echo Done! Restarting app...
%ADB% shell am force-stop com.hiva.runtime
%ADB% shell am start -n com.hiva.runtime/.MainActivity

echo.
echo Model deployed. Check logs with:
echo %ADB% logcat -s EdgeBrain:* LiquidInferenceEngine:*

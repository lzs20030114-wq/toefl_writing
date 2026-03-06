@echo off
"C:\Program Files\Git\usr\bin\bash.exe" --login -i -c "export HTTP_PROXY=http://127.0.0.1:10808; export HTTPS_PROXY=http://127.0.0.1:10808; export NO_PROXY=localhost,127.0.0.1; gemini"

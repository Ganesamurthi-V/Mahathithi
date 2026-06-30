# MahaAtithi Single-Click Startup Script

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " Starting MahaAtithi Local Environment...     " -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check for global .env
if (-Not (Test-Path ".env")) {
    Write-Host "[!] Global .env file not found." -ForegroundColor Yellow
    Write-Host "[*] Creating one from .env.example..." -ForegroundColor Green
    Copy-Item ".env.example" ".env"
    
    Write-Host ""
    Write-Host "==========================================================================" -ForegroundColor Red
    Write-Host " ACTION REQUIRED: " -ForegroundColor Red
    Write-Host " I have created a .env file for you in the root directory." -ForegroundColor Yellow
    Write-Host " Please open the .env file, add your Supabase DATABASE_URL and Railway credentials," -ForegroundColor Yellow
    Write-Host " save it, and then run this script again." -ForegroundColor Yellow
    Write-Host "==========================================================================" -ForegroundColor Red
    Pause
    exit
}

# 2. Check if DATABASE_URL is filled
$envContent = Get-Content ".env" | Out-String
if ($envContent -match 'DATABASE_URL="postgres://postgres.\[YOUR_PROJECT_REF\]') {
    Write-Host ""
    Write-Host "==========================================================================" -ForegroundColor Red
    Write-Host " ACTION REQUIRED: " -ForegroundColor Red
    Write-Host " You haven't configured the DATABASE_URL in the .env file!" -ForegroundColor Yellow
    Write-Host " Please open the .env file, replace the placeholder with your actual Supabase URL," -ForegroundColor Yellow
    Write-Host " save it, and then run this script again." -ForegroundColor Yellow
    Write-Host "==========================================================================" -ForegroundColor Red
    Pause
    exit
}

# 3. Configure Mobile App Environment
Write-Host "[*] Configuring Mobile App environment..." -ForegroundColor Cyan
$mobileEnvPath = "mobile\.env"
$emulatorUrl = "API_BASE_URL=http://10.0.2.2:3000/api"
Set-Content -Path $mobileEnvPath -Value $emulatorUrl
Write-Host "    -> Wrote API_BASE_URL for Android Emulator to $mobileEnvPath" -ForegroundColor Green

# 4. Start Docker Compose
Write-Host ""
Write-Host "[*] Starting Backend and Admin Panel via Docker Compose..." -ForegroundColor Cyan
Write-Host "    (This might take a few minutes the first time to download and build)" -ForegroundColor Gray
docker-compose up -d --build

if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] Failed to start Docker Compose. Is Docker Desktop running?" -ForegroundColor Red
    Pause
    exit
}

Write-Host "    -> Docker services started successfully." -ForegroundColor Green
Write-Host ""

# 5. Launch Android App
Write-Host "[*] Starting React Native Mobile App..." -ForegroundColor Cyan
Write-Host "    Please ensure your Android Emulator is running, or a device is connected." -ForegroundColor Yellow
Write-Host "    Waiting 5 seconds for backend to initialize..." -ForegroundColor Gray
Start-Sleep -Seconds 5

cd mobile
if (-Not (Test-Path "node_modules")) {
    Write-Host "[*] Installing mobile dependencies..." -ForegroundColor Cyan
    npm install
}

Write-Host "[*] Launching Android App..." -ForegroundColor Cyan
npm run android

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " Setup Complete! " -ForegroundColor Green
Write-Host " - Admin Panel: http://localhost:5173" -ForegroundColor Cyan
Write-Host " - Backend API: http://localhost:3000" -ForegroundColor Cyan
Write-Host " - Mobile App: Running on your emulator" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Pause

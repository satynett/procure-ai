# ProcureShield — Windows Setup

## Run the Project on a Fresh Windows Laptop

Follow these steps in order. This guide assumes Node.js, Python, Git and PostgreSQL are not installed.

### 1. Install Git

Download Git for Windows:
https://git-scm.com/download/win

Install it using the default options.

Open PowerShell and check:

```powershell
git --version
```

### 2. Install Node.js

Download the LTS version of Node.js:
https://nodejs.org/

Install it using the default options.

Close PowerShell, open a new PowerShell, and check:

```powershell
node --version
npm --version
```

Both commands should show a version.

### 3. Install Python

Download Python 3.11 or newer:
https://www.python.org/downloads/windows/

During installation, check **Add python.exe to PATH**.

Open a new PowerShell and check:

```powershell
python --version
```

### 4. Install PostgreSQL

Download PostgreSQL for Windows:
https://www.postgresql.org/download/windows/

Install it with the default options.

During installation:
- Keep port: `5432`
- Username: `postgres`
- Remember the password you create
- Install pgAdmin 4

Make sure PostgreSQL is running after installation.

### 5. Create the Database

Open **pgAdmin 4**.

Create a new database named:

```text
procureshield
```

Do not create any tables manually.

### 6. Download the Project

Open **PowerShell** and run:

```powershell
cd "$HOME\Downloads"
git clone https://github.com/satynett/procure-ai.git
cd procure-ai\procureshield-3
git checkout ai-integration
```

### 7. Create the Python Environment

Inside `procureshield-3`, run:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell gives an execution-policy error, run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then activate again:

```powershell
.\.venv\Scripts\Activate.ps1
```

### 8. Install Project Dependencies

Run:

```powershell
npm install
npm run install:all
```

Wait for the installation to finish. It may take several minutes.

### 9. Configure PostgreSQL

Create the environment file:

```powershell
Copy-Item server\.env.example server\.env
notepad server\.env
```

Find the `DATABASE_URL` line and replace the PostgreSQL password with the password you created during installation.


Example:

```env
DATABASE_URL=postgresql://postgres:MyPassword@localhost:5432/procureshield
```

Save and close the file.

### 10. Start the Project

Make sure the Python environment is active. You should see `(.venv)` in PowerShell.

Run:

```powershell
npm run dev
```

This starts the React website, Node backend and Python Network/Risk Analysis engine.

Keep this PowerShell window open.

### 11. Open the Website

Open your browser and go to:

http://localhost:5173

Login:

```text
Username: admin
Password: admin123
```

## Every Time You Want to Run the Project Again

After the first setup, you do not need to reinstall anything.

Open PowerShell and run:

```powershell
cd "$HOME\Downloads\procure-ai\procureshield-3"
.\.venv\Scripts\Activate.ps1
npm run dev
```

Then open:

http://localhost:5173

Keep the terminal open while using the website.

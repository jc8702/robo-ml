Get-CimInstance Win32_Process -Filter "name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*.ig-profile*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

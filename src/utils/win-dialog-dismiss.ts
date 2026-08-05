import { exec } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Detecta e fecha automaticamente qualquer janela nativa de diálogo do Windows
 * (ex: 'Abrir' ou 'Open' com classe #32770) disparada pelo Chrome/Chromium.
 * Previne que o robô fique paralisado aguardando ação manual do usuário no sistema operacional.
 */
export async function dismissNativeWindowsFileDialogs(): Promise<void> {
  if (platform() !== 'win32') return;

  const psScript = `
$code = @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class WinDialogDismiss {
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    public const uint WM_CLOSE = 0x0010;

    public static void CloseOpenDialogs() {
        IntPtr hWnd = IntPtr.Zero;
        while ((hWnd = FindWindowEx(IntPtr.Zero, hWnd, "#32770", null)) != IntPtr.Zero) {
            StringBuilder sb = new StringBuilder(256);
            GetWindowText(hWnd, sb, 256);
            string title = sb.ToString();
            if (title.Equals("Abrir", StringComparison.OrdinalIgnoreCase) || title.Equals("Open", StringComparison.OrdinalIgnoreCase) || title.Contains("Abrir") || title.Contains("Open")) {
                PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            }
        }
    }
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
[WinDialogDismiss]::CloseOpenDialogs()
`;

  return new Promise((resolve) => {
    try {
      const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/\n/g, ' ')}"`;
      exec(command, { timeout: 3000 }, (error) => {
        if (error) {
          exec(`powershell -NoProfile -Command "Get-Process -Name chrome -ErrorAction SilentlyContinue | ForEach-Object { $wshell = New-Object -ComObject wscript.shell; if ($wshell.AppActivate($_.Id)) { Start-Sleep -m 100; $wshell.SendKeys('{ESC}') } }"`, { timeout: 2000 }, () => resolve());
        } else {
          resolve();
        }
      });
    } catch {
      resolve();
    }
  });
}

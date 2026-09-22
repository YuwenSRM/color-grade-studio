Option Explicit

Dim shell, filesystem, launcherPath, command

Set shell = CreateObject("WScript.Shell")
Set filesystem = CreateObject("Scripting.FileSystemObject")
launcherPath = filesystem.BuildPath(filesystem.GetParentFolderName(WScript.ScriptFullName), "ColorGradeStudio.ps1")

If Not filesystem.FileExists(launcherPath) Then
  MsgBox "ColorGradeStudio.ps1 is missing. Restore the complete standalone package.", 16, "Color Grade Studio"
  WScript.Quit 1
End If

command = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & launcherPath & Chr(34) & " -NoOpen"
shell.Run command, 0, False
WScript.Sleep 750
shell.Run "http://127.0.0.1:4174/", 1, False

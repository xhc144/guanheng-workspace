' 验收.vbs — PMS v1.0.0 零依赖验收 (双击运行)
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)

Dim files(13)
files(0) = "backend\app\main.py"
files(1) = "backend\app\models\__init__.py"
files(2) = "backend\app\routes\auth.py"
files(3) = "backend\tests\test_core.py"
files(4) = "backend\requirements.txt"
files(5) = "frontend\src\main.tsx"
files(6) = "frontend\src\App.tsx"
files(7) = "frontend\package.json"
files(8) = "verify_goal.py"
files(9) = "verify_goal.ps1"
files(10) = "start.bat"
files(11) = "README.md"
files(12) = "验收面板.html"

ok = 0 : miss = 0
For Each f In files
  If fso.FileExists(root & "\" & f) Then
    ok = ok + 1
  Else
    WScript.Echo "MISS: " & f
    miss = miss + 1
  End If
Next

If miss = 0 Then
  MsgBox "✓ PMS v0.2.1 核心文件完整 (" & ok & "/" & (ok+miss) & ")" & vbCrLf & vbCrLf & "下一步: python run_verify.py", 0, "PMS 验收"
Else
  MsgBox "✗ " & miss & " 个文件缺失" & vbCrLf & ok & "/" & (ok+miss) & " 通过", 48, "PMS 验收"
End If

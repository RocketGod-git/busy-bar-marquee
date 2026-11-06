' Starts the Marquee widget with no console window and opens it as an app window in Edge.
' If the widget server is already running, this just opens another window.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "node server.mjs --open", 0, False

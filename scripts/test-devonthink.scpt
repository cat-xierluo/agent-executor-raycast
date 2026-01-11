-- DEVONthink 集成测试脚本
-- 使用方法：在 DEVONthink 中选中一个文档，然后运行此脚本

tell application id "com.devon-technologies.thinkpro2"
	try
		set theSelection to the selection
		if theSelection is {} then
			display dialog "请在 DEVONthink 中选中至少一个文档" buttons {"确定"} default button "确定"
			return
		end if

		set resultText to "选中的文档：" & return & return

		repeat with i from 1 to count of theSelection
			set theRecord to item i of theSelection
			set theName to name of theRecord
			set thePath to path of theRecord
			set theUUID to id of theRecord

			set resultText to resultText & (i as string) & ". " & theName & return
			set resultText to resultText & "   路径: " & thePath & return
			set resultText to resultText & "   UUID: " & theUUID & return & return
		end repeat

		display dialog resultText buttons {"复制到剪贴板", "确定"} default button "确定"

		-- 如果用户点击"复制到剪贴板"
		set the clipboard to resultText

	on error errMsg
		display dialog "错误: " & errMsg buttons {"确定"} default button "确定"
	end try
end tell

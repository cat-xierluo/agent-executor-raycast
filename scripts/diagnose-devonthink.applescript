-- DevonThink 诊断脚本
-- 测试多种方式获取选中记录的路径和引用

tell application id "com.devon-technologies.thinkpro2"
	try
		set theSelection to the selection
		if theSelection is {} then
			return "No selection - 请在 DevonThink 中选中一个文件"
		end if

		set theRecord to item 1 of theSelection

		-- 测试 1: 基本属性
		set theName to name of theRecord
		set theID to id of theRecord
		set theType to type of theRecord
		set theKind to kind of theRecord

		-- 测试 2: path 属性（可能为空）
		try
			set thePath to path of theRecord
		on error
			set thePath to "N/A"
		end try

		-- 测试 3: location 属性
		try
			set theLocation to location of theRecord
		on error
			set theLocation to "N/A"
		end try

		-- 测试 4: 创建临时引用（用于文件访问）
		try
			set theRef to theRecord as alias
			set theRefPath to POSIX path of theRef
		on error errMsg
			set theRefPath to "Error: " & errMsg
		end try

		-- 测试 5: 数据库信息
		try
			set theDatabase to database of theRecord
			set theDBName to name of theDatabase
		on error
			set theDBName to "N/A"
		end try

		-- 测试 6: 是否有自定义 URL
		try
			set theURL to reference URL of theRecord
		on error
			set theURL to "N/A"
		end try

		-- 测试 7: content path（如果有）
		try
			set theContentPath to content path of theRecord
		on error
			set theContentPath to "N/A"
		end try

		-- 汇总结果
		set resultText to "
=== DevonThink 记录诊断 ===

名称: " & theName & "
UUID: " & theID & "
类型: " & theType & "
种类: " & theKind & "

=== 路径信息 ===
path 属性: " & thePath & "
location 属性: " & theLocation & "
content path: " & theContentPath & "
alias 转换: " & theRefPath & "
reference URL: " & theURL & "

=== 数据库信息 ===
数据库: " & theDBName & "

=== 结论 ===
"

		-- 判断最佳的路径获取方式
		if thePath is not "N/A" and thePath is not "" then
			set resultText to resultText & "✓ 推荐使用 'path' 属性"
		else if theRefPath is not "N/A" and theRefPath does not contain "Error" then
			set resultText to resultText & "✓ 推荐使用 'as alias' 转换"
		else if theContentPath is not "N/A" and theContentPath is not "" then
			set resultText to resultText & "✓ 推荐使用 'content path' 属性"
		else
			set resultText to resultText & "✗ 无法获取文件系统路径，可能需要使用 x-callback-url 或其他方式"
		end if

		return resultText

	on error errMsg
		return "Error: " & errMsg
	end try
end tell

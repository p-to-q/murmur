-- Murmur Video Generation Pipeline Test
-- Generates seed frame for Scene 03 via GPT-Image-2

set shellCommand to "export PATH=$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH && cd /Users/dujiayi/code/murmur && bun run scripts/video-gen.ts seed --scene 03 2>&1"

try
	set shellResult to do shell script shellCommand
	return shellResult
on error errMsg number errNum
	return "Error " & errNum & ": " & errMsg
end try

export default (tags, autoBreakBeforeWrap = false, autoBreakAfterWrap = false) => {
    if (tags === null || tags === undefined || tags === false || tags === "" || tags.trim() === "") return []

    tags = tags.replace(/，/g, ',') // 中文逗号
    tags = tags.replace(/。/g, ',') // 中文句号
    tags = tags.replace(/、/g, ',') // 中文顿号
    tags = tags.replace(/；/g, ',') // 中文分号
    tags = tags.replace(/．/g, ',') // 日文句号

    tags = tags.replace(/\t/g, '\n') // 制表符
    tags = tags.replace(/\r/g, '\n') // 回车符
    tags = tags.replace(/\n+/g, '\n') // 连续换行符

    let emojis = [
        { emoji: ">_<", re: /\>_\</g },
        { emoji: ":<", re: /\:\</g },
        { emoji: ">:<", re: /\>\:\</g },
        { emoji: ":>", re: /\:\>/g },
        { emoji: ":-(", re: /\:\-\(/g },
        { emoji: ":-)", re: /\:\-\)/g },
    ]
    emojis.forEach((emoji, index) => {
        tags = tags.replace(emoji.re, "|||EXPRESSION" + index + "|||")
    })

    const brackets = {
        '(': ')',
        '[': ']',
        '<': '>',
        '{': '}'
    }
    const bracketStarts = Object.keys(brackets)

    let length = tags.length
    let temp = ''
    let startBracketChar = ''
    let endBracketChar = ''
    let bracketCount = 0
    let inWeightBlock = false;
    let result = []
    for (let i = 0; i < length; i++) {
        const char = tags[i]

        // Detect Weight Block :: start/end
        if (char === ':' && tags[i + 1] === ':') {
            if (!inWeightBlock && startBracketChar === '') {
                inWeightBlock = true;
                temp += '::';
                i++;
                continue;
            } else if (inWeightBlock) {
                // If we see :: and it was preceded by a space, it's likely the end
                // or if it's the very end of the string.
                // NovelAI usually uses " ::" as closer.
                inWeightBlock = false;
                temp += '::';
                i++;
                continue;
            }
        }

        if (char === "\n") {
            if (startBracketChar === '' && !inWeightBlock) {
                // 前面没有括号且不在权重块中
                if (temp.trim() !== "") {
                    result.push(temp.trim())
                }
                result.push("\n")
                bracketCount = 0
                startBracketChar = ''
                endBracketChar = ''
                inWeightBlock = false;
                temp = ''
            } else {
                // 前面有括号或在权重块中
                temp += ' '
            }
        } else if (char === ",") {
            if (startBracketChar === '' && !inWeightBlock) {
                // 前面没有括号且不在权重块中
                result.push(temp.trim())
                bracketCount = 0
                startBracketChar = ''
                endBracketChar = ''
                inWeightBlock = false;
                temp = ''
            } else {
                // 前面有括号或在权重块中
                temp += char
            }
        } else {
            if (startBracketChar === '' && !inWeightBlock) {
                // 前面没有括号
                if (bracketStarts.includes(char)) {
                    // 括号开始
                    bracketCount = 1
                    startBracketChar = char
                    endBracketChar = brackets[char]
                    temp += char
                } else {
                    if (char === " " && temp.trim() === 'BREAK') {
                        result.push(temp.trim())
                        bracketCount = 0
                        startBracketChar = ''
                        endBracketChar = ''
                        temp = ''
                    } else {
                        temp += char
                        if (temp.endsWith(' BREAK')) {
                            temp = temp.substring(0, temp.length - ' BREAK'.length)
                            result.push(temp.trim())
                            result.push('BREAK')
                            bracketCount = 0
                            startBracketChar = ''
                            endBracketChar = ''
                            temp = ''
                        }
                    }
                }
            } else {
                // 前面有括号
                if (char === endBracketChar) {
                    // 是结束括号的标识，减掉括号计数
                    bracketCount--
                    if (bracketCount === 0) {
                        // 括号计数为0，括号结束
                        startBracketChar = ''
                        endBracketChar = ''
                        temp += char
                    } else {
                        temp += char
                    }
                } else if (char === startBracketChar) {
                    // 是开始括号的标识，加上括号计数
                    bracketCount++
                    temp += char
                } else {
                    temp += char
                }
            }
        }
    }
    if (temp !== '') {
        result.push(temp.trim())
    }

    let result2 = []
    for (let value of result) {
        if (value === "\n") {
            result2.push(value)
            continue
        }
        let start = value[0]
        let end = value[value.length - 1]
        if (start === '[' && end === ']') {
            result2.push(value)
            continue
        }
        if (start === '(' && end === ')') {
            result2.push(value)
            continue
        }
        if (start === '{' && end === '}') {
            result2.push(value)
            continue
        }

        // aaa <lora:KuutanKoihime:0.7>  <lora:add_detail:0.6><lora:clothesTransparent_v20:1:1,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0>, [<lora:A:1>:<lora:B:1>:10], [lora:A:1::10], [<lora:A:1>:10], [<lora:A:1>:0.5], [[<lora:A:1>::25]:10], [<lora:A:1> #increment:10], [<lora:A:1> #decrease:10], [<lora:A:1> #cmd\(warmup\(0.5\)\):10]
        let regex = /\<lora:[^\>]+\>/
        let match = null
        let values = []
        while (match = regex.exec(value)) {
            let startIndex = match.index
            let endIndex = startIndex + match[0].length
            let before = value.substring(0, startIndex).trim()
            let after = value.substring(endIndex).trim()
            let middle = match[0]
            values.push(before)
            values.push(middle)
            value = after
        }
        values.push(value)
        for (let value2 of values) {
            if (value2 === '' || value2.trim() === '') continue
            emojis.forEach((emoji, index) => {
                value2 = value2.replace("|||EXPRESSION" + index + "|||", emoji.emoji)
            })
            // value2 = value2.replace(/\|\|\|EXPRESSION1\|\|\|/g, '>_<')
            result2.push(value2)
        }
    }
    result = result2

    return result
}

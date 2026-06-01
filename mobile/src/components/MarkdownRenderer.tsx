import React, { useState } from 'react';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import * as Clipboard from 'expo-clipboard';

function parseInline(content: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`|\$(.+?)\$)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<Text key={`b-${match.index}`} style={s.bold}>{match[2]}</Text>);
    } else if (match[3]) {
      parts.push(<Text key={`c-${match.index}`} style={s.inlineCode}>{match[3]}</Text>);
    } else if (match[4]) {
      parts.push(<Text key={`m-${match.index}`} style={s.math}>{match[4]}</Text>);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length ? parts : [content];
}

function parseParagraph(line: string, key: number | string): React.ReactNode | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    return (
      <View key={key} style={s.listItem}>
        <Text style={s.listBullet}>•</Text>
        <Text style={s.paragraph}>{parseInline(trimmed.slice(2))}</Text>
      </View>
    );
  }

  if (/^\d+\.\s/.test(trimmed)) {
    const num = trimmed.match(/^\d+/)?.[0];
    return (
      <View key={key} style={s.listItem}>
        <Text style={s.listNumber}>{num}.</Text>
        <Text style={s.paragraph}>{parseInline(trimmed.replace(/^\d+\.\s/, ''))}</Text>
      </View>
    );
  }

  if (trimmed.startsWith('#')) {
    const level = trimmed.match(/^#+/)?.[0].length || 1;
    const headingText = trimmed.replace(/^#+\s*/, '');
    const headingStyle = level <= 2 ? s.h2 : s.h3;
    return <Text key={key} style={headingStyle}>{parseInline(headingText)}</Text>;
  }

  return <Text key={key} style={s.paragraph}>{parseInline(trimmed)}</Text>;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={s.codeBlock}>
      <View style={s.codeHeader}>
        <Text style={s.codeLang}>{language || 'code'}</Text>
        <TouchableOpacity
          style={s.codeCopyBtn}
          onPress={async () => {
            await Clipboard.setStringAsync(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          <Text style={s.codeCopyText}>{copied ? 'Copied!' : 'Copy'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={s.codeText}>{code}</Text>
    </View>
  );
}

const MarkdownRenderer = React.memo(({ content }: { content: string }) => {
  if (!content) return null;

  const blocks: React.ReactNode[] = [];
  let keyCounter = 0;

  const parts: { type: 'text' | 'display-math'; content: string }[] = [];
  const displayMathRegex = /\$\$([\s\S]*?)\$\$/g;
  let lastIdx = 0;
  let dmMatch;

  while ((dmMatch = displayMathRegex.exec(content)) !== null) {
    if (dmMatch.index > lastIdx) {
      parts.push({ type: 'text', content: content.slice(lastIdx, dmMatch.index) });
    }
    parts.push({ type: 'display-math', content: dmMatch[1].trim() });
    lastIdx = dmMatch.index + dmMatch[0].length;
  }
  if (lastIdx < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIdx) });
  }

  if (parts.length === 0) parts.push({ type: 'text', content });

  for (const part of parts) {
    if (part.type === 'display-math') {
      blocks.push(
        <View key={`dm-${keyCounter++}`} style={s.displayMath}>
          <Text style={s.displayMathText}>{part.content}</Text>
        </View>
      );
      continue;
    }

    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let cbLastIdx = 0;
    let cbMatch;

    while ((cbMatch = codeBlockRegex.exec(part.content)) !== null) {
      if (cbMatch.index > cbLastIdx) {
        const text = part.content.slice(cbLastIdx, cbMatch.index);
        const lines = text.split('\n');
        for (const line of lines) {
          const node = parseParagraph(line, keyCounter++);
          if (node) blocks.push(node);
        }
      }

      blocks.push(
        <CodeBlock
          key={`cb-${keyCounter++}`}
          code={cbMatch[2].trim()}
          language={cbMatch[1]}
        />
      );

      cbLastIdx = cbMatch.index + cbMatch[0].length;
    }

    if (cbLastIdx < part.content.length) {
      const text = part.content.slice(cbLastIdx);
      const lines = text.split('\n');
      for (const line of lines) {
        const node = parseParagraph(line, keyCounter++);
        if (node) blocks.push(node);
      }
    }
  }

  return <View style={s.container}>{blocks}</View>;
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

const s = StyleSheet.create({
  container: { gap: 4 },
  paragraph: { fontSize: 14, color: '#e5e7eb', lineHeight: 20 },
  bold: { fontWeight: 'bold', color: '#fff' },
  inlineCode: {
    backgroundColor: '#2c2d2e',
    color: '#f59e0b',
    fontFamily: 'monospace',
    fontSize: 13,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  math: { fontStyle: 'italic', color: '#a78bfa', fontFamily: 'monospace' },
  displayMath: {
    backgroundColor: '#0c0c0e',
    borderRadius: 8,
    padding: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.15)',
    alignItems: 'center',
  },
  displayMathText: {
    fontStyle: 'italic',
    color: '#c4b5fd',
    fontFamily: 'monospace',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  codeBlock: {
    backgroundColor: '#1e1f20',
    borderRadius: 8,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#0c0c0e',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  codeLang: { fontSize: 10, color: '#6b7280', textTransform: 'uppercase', fontWeight: 'bold' },
  codeCopyBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  codeCopyText: { fontSize: 10, color: '#9ca3af' },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#d1d5db',
    lineHeight: 18,
    padding: 12,
  },
  listItem: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 2,
  },
  listBullet: { color: '#6b7280', fontSize: 14, lineHeight: 20 },
  listNumber: { color: '#6b7280', fontSize: 14, lineHeight: 20, fontWeight: 'bold' },
  h2: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginTop: 12, marginBottom: 4 },
  h3: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginTop: 8, marginBottom: 4 },
});

export default MarkdownRenderer;

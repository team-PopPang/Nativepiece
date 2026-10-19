import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useHost, useHostMessage } from '@team-poppang/nativepiece-runtime';
import contract from '../../nativepiece.contract';

export function HomeScreen({ userName }: { userName: string }) {
  const host = useHost();
  const [count, setCount] = useState(0);
  const [dark, setDark] = useState(false);
  const [appInfo, setAppInfo] = useState('불러오는 중');

  useEffect(() => {
    host
      .call(contract.calls.getAppInfo)
      .then(({ appVersion, platform }) => setAppInfo(`${platform} ${appVersion}`))
      .catch((error: Error) => setAppInfo(`오류: ${error.message}`))
      // 호스트 정보까지 받았으면 화면을 쓸 수 있는 상태예요.
      .finally(() => host.markReady());
  }, [host]);

  useHostMessage(contract.messages.themeChanged, ({ dark }) => setDark(dark));

  const press = () => {
    const next = count + 1;
    setCount(next);
    host.emit(contract.events.buttonPressed, { count: next });
  };

  const colors = dark ? darkColors : lightColors;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>안녕하세요, {userName}님</Text>
      <Text style={[styles.caption, { color: colors.caption }]}>호스트 앱: {appInfo}</Text>
      <Pressable style={[styles.button, { backgroundColor: colors.button }]} onPress={press}>
        <Text style={styles.buttonText}>눌러 보기 ({count})</Text>
      </Pressable>
      <Pressable style={styles.link} onPress={() => host.close()}>
        <Text style={{ color: colors.caption }}>닫기</Text>
      </Pressable>
    </View>
  );
}

const lightColors = { background: '#FFFFFF', text: '#191F28', caption: '#6B7684', button: '#3182F6' };
const darkColors = { background: '#17171C', text: '#FFFFFF', caption: '#9EA4AA', button: '#3182F6' };

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: '700' },
  caption: { fontSize: 15, marginTop: 8 },
  button: { marginTop: 32, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  link: { marginTop: 16, padding: 8 },
});

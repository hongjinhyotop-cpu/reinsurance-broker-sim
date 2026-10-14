# 글꼴 다시 만들기 (개발자용, 게임 실행에는 필요 없음)

게임이 쓰는 한글은 원본 글꼴의 일부분(subset)입니다. 콘텐츠를 크게 늘려 새 글자가 필요해지면 다시 만듭니다.
**빌드 도구가 아니라 한 번 실행하는 명령**이며, 결과 파일(`*.subset.woff2`)만 저장소에 올립니다.

```bash
pip install fonttools brotli
# 원본: https://github.com/google/fonts/tree/main/ofl/{notoserifkr,notosanskr,jetbrainsmono}
# 1) 쓰인 글자 목록 = data/*.json + js/**/*.js + index.html + css/*.css 안의 모든 글자 + ASCII
# 2) 명조는 굵기 700으로 고정, 고딕은 400~700 범위로 줄인다
python3 -m fontTools.varLib.instancer "NotoSerifKR[wght].ttf" wght=700 -o serif700.ttf
python3 -m fontTools.varLib.instancer "NotoSansKR[wght].ttf" wght=400:700 -o sansvar.ttf
# 3) 명조: 쓰인 글자만 / 고딕: 쓰인 글자 + KS X 1001 한글 2,350자
pyftsubset serif700.ttf --text-file=chars_used.txt --flavor=woff2 --layout-features='kern,liga' --output-file=NotoSerifKR-Bold.subset.woff2
pyftsubset sansvar.ttf  --text-file=chars_ks.txt   --flavor=woff2 --layout-features='kern,liga' --output-file=NotoSansKR-Variable.subset.woff2
pyftsubset "JetBrainsMono[wght].ttf" --unicodes="U+0020-007E,U+00B7,U+00D7,U+2212,U+2013,U+2014,U+25B6" --flavor=woff2 --layout-features='*' --output-file=JetBrainsMono-Variable.subset.woff2
```

목록에 없는 글자는 `--font-serif`/`--font-sans`의 다음 글꼴(시스템 글꼴)로 이어서 그려집니다.

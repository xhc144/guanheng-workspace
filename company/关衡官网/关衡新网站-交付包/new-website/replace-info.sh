#!/bin/bash
# ============================================================
# 关衡软件新版官网 · 真实信息一键替换脚本
# 用法：编辑下方变量为你的真实信息，然后运行  bash replace-info.sh
# ============================================================

# ===== 在这里填写真实信息 =====
PHONE="400-XXX-XXXX"          # 真实服务热线，例如 400-888-1234
ICP="粤ICP备XXXXXXXX号"        # 真实ICP备案号，例如 粤ICP备12345678号
EMAIL="xueguoyin@zgsoft.com.cn" # 联系邮箱（已是旧站真实邮箱，一般不用改）
# =============================

cd "$(dirname "$0")"

echo "开始替换..."
for f in *.html; do
  # 电话
  sed -i '' "s/400-XXX-XXXX/${PHONE}/g" "$f"
  # 备案号
  sed -i '' "s/粤ICP备XXXXXXXX号/${ICP}/g" "$f"
  # 邮箱（如需更换才取消注释）
  # sed -i '' "s/xueguoyin@zgsoft.com.cn/${EMAIL}/g" "$f"
done

echo "替换完成："
echo "  电话 -> ${PHONE}"
echo "  备案号 -> ${ICP}"
grep -c "${PHONE}" index.html | xargs echo "  首页电话出现次数:"

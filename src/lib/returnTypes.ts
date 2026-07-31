/* 退料类型键值与中文标签(服务端/客户端组件均可引用) */
export const 退料类型标签: Record<string, string> = {
  excess: "多领",
  wrong_pick: "错领",
  wrong_ship: "发错货",
  damaged: "损坏",
};

export const 退料类型选项 = [
  { key: "excess", label: "多领" },
  { key: "wrong_pick", label: "错领" },
  { key: "wrong_ship", label: "发错货" },
  { key: "damaged", label: "损坏" },
];

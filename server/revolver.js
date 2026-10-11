class Revolver {
  constructor(chamberSize) {
    this.chamberSize = chamberSize;
    this.reset();
  }

  reset() {
    this.bulletPos = Math.floor(Math.random() * this.chamberSize);
    this.currentPos = 0;
  }

  fire() {
    if (this.currentPos === this.bulletPos) {
      this.reset();
      return { fired: true };
    }
    this.currentPos = (this.currentPos + 1) % this.chamberSize;
    return { fired: false };
  }

  toJSON() {
    return {
      chamberSize: this.chamberSize,
      currentPos: this.currentPos,
      // 客户端不能知道子弹位置，只返回结构
      hasBullet: true
    };
  }
}

module.exports = Revolver;

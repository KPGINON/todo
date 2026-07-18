/**
 * 密码强度检测
 */
document.addEventListener('DOMContentLoaded', function() {
  const passwordInput = document.getElementById('password');
  const strengthFill = document.getElementById('strengthFill');
  const confirmPasswordInput = document.getElementById('confirmPassword');
  const form = document.querySelector('form');
  const errorElement = document.querySelector('.error');

  // 密码强度检测函数
  function checkPasswordStrength(password) {
    let strength = 0;
    let message = '';

    // 检查长度
    if (password.length >= 8) strength += 1;
    if (password.length >= 12) strength += 1;

    // 检查复杂度
    if (/[a-z]/.test(password)) strength += 1;
    if (/[A-Z]/.test(password)) strength += 1;
    if (/\d/.test(password)) strength += 1;
    if (/[^\w\s]/.test(password)) strength += 1;

    // 根据强度返回结果
    if (strength < 3) {
      message = '弱';
      return { level: 'weak', width: '30%', message: message };
    } else if (strength < 5) {
      message = '中等';
      return { level: 'medium', width: '60%', message: message };
    } else {
      message = '强';
      return { level: 'strong', width: '100%', message: message };
    }
  }

  // 更新密码强度显示
  function updatePasswordStrength() {
    const password = passwordInput.value;
    if (password) {
      const result = checkPasswordStrength(password);
      strengthFill.className = `strength-fill strength-${result.level}`;
      strengthFill.style.width = result.width;
    } else {
      strengthFill.className = 'strength-fill';
      strengthFill.style.width = '0%';
    }
  }

  // 验证密码确认
  function validatePasswordMatch() {
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (confirmPassword && password !== confirmPassword) {
      showError('两次输入的密码不一致');
      return false;
    }

    clearError();
    return true;
  }

  // 显示错误消息
  function showError(message) {
    if (errorElement) {
      errorElement.textContent = message;
    }
  }

  // 清除错误消息
  function clearError() {
    if (errorElement) {
      errorElement.textContent = '';
    }
  }

  // 事件监听器
  passwordInput.addEventListener('input', updatePasswordStrength);

  confirmPasswordInput.addEventListener('input', function() {
    if (confirmPasswordInput.value) {
      validatePasswordMatch();
    }
  });

  form.addEventListener('submit', function(e) {
    if (!validatePasswordMatch()) {
      e.preventDefault();
      return false;
    }

    // 如果有错误消息，清除它
    clearError();
    return true;
  });

  // 初始状态
  updatePasswordStrength();
});
## Criar primeiro usuário admin

Vou criar o usuário `marciotemperine@gmail.com` com a senha `Criativo@2026` já confirmado (sem precisar de verificação de email) e atribuir a ele a role `admin`.

### Passos

1. **Criar usuário no Auth** via `supabase.auth.admin.createUser` (email confirmado automaticamente).
   - O trigger `handle_new_user` já existente vai criar automaticamente:
     - Linha em `profiles` com `display_name = "marciotemperine"`
     - Linha em `user_roles` com role `member`

2. **Promover para admin**: atualizar o registro em `user_roles` trocando `member` por `admin` para esse `user_id`.

3. **Confirmar**: você poderá fazer login imediatamente em `/auth` com essas credenciais.

### Observação de segurança

A senha `Criativo@2026` ficará registrada nesta conversa. Recomendo trocá-la após o primeiro login (posso adicionar uma tela de "trocar senha" depois, se quiser).

### Próximos passos sugeridos (não fazem parte deste turno)

- Tela admin para convidar/criar novos usuários da equipe (já que o login é "convite manual pelo admin").
- Painel para promover/rebaixar roles.

Posso prosseguir?
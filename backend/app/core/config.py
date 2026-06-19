from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Provided by the coders.kr platform via coders.yaml substitution.
    database_url: str = "postgresql+asyncpg://app:app@localhost:5432/app"

    # Managed LLM (coders.kr §8). The platform injects these; the
    # Anthropic SDK reads ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY from env
    # directly, so we don't have to thread them through — but we keep the
    # default model and allow-list here for seeding + validation.
    default_model: str = "claude-sonnet-4-6"
    # Models the platform LLM proxy is allowed to serve (mirror coders.yaml).
    allowed_models: str = "claude-opus-4-8,claude-sonnet-4-6,claude-haiku-4-5"

    # Local-dev escape hatch: when set, an X-Coders-User-less request is
    # treated as if it came from this UUID. Never set in production.
    dev_fake_user: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def allowed_model_list(self) -> list[str]:
        return [m.strip() for m in self.allowed_models.split(",") if m.strip()]


settings = Settings()
